# Member Usage Filter Grammar and Read Model Design

Date: 2026-06-26
Status: Approved design, pending written spec review

## Context

The Member usage dialog, API route, and server read model already support range, period, provider, model, and device filters. The behavior is useful, but the filter rules are split across the dialog, chart helpers, route parser, and `getMemberUsageDetail`. That creates two maintenance problems:

- The URL grammar has more than one source of truth. The client constructs query strings while the server validates and normalizes the same concepts.
- The read model has too much orchestration in one function, and tests lean on Prisma call order instead of the observable `MemberUsageDetail` behavior.

This refactor works on two candidates together:

1. Give Member usage filters one grammar.
2. Deepen the Member usage read model.

## Goals

- Make `member-usage-query.ts` the shared grammar for Member usage query parsing, encoding, defaults, and filter invariants.
- Keep the route thin: parse the request, call the read model, map expected HTTP errors, and validate the response schema.
- Keep the external read-model API stable as `getMemberUsageDetail(username, query, now)`.
- Split the read-model internals into small, named policy and mapping helpers that can be understood and tested independently.
- Preserve public behavior unless a small behavior change makes the API or UI more obvious and functional.
- Reduce brittle tests that depend on internal Prisma call order when the same confidence can come from returned detail assertions.

## Non-Goals

- Do not introduce a generic repository layer.
- Do not redesign the Member usage UI.
- Do not change the public `MemberUsageDetail` response shape unless a bug-level improvement is required.
- Do not expand this work into sync collection, scheduler, or unrelated leaderboard cleanup.
- Do not add design-pattern ceremony where a local helper or module boundary is enough.

## Architecture

This is a focused combined refactor with two cooperating modules.

`apps/web/src/server/member-usage-query.ts` becomes the shared Member usage filter grammar. It owns:

- default range and period behavior
- parsing `URLSearchParams`
- encoding selected filters into `URLSearchParams`
- model key format, using `<provider>:<modelName>`
- provider and model mutual exclusion
- device filter validation
- shared empty/default filter values
- equality and toggle helpers where they prevent duplicate client/server rules

The route and dialog both call this grammar module. The route parses request params. The dialog builds URLs from selected state through the encoder. Charts can still render selected filter state, but they should stop carrying grammar facts such as model-key string construction when the grammar can own those facts.

`apps/web/src/server/leaderboard.ts` keeps the external `getMemberUsageDetail(username, query, now)` interface. Internally, the Member usage read model is deepened by separating policy and mapping concerns inside `leaderboard.ts` or nearby server files. The target is not a repository abstraction. The target is a set of cohesive helpers that make the read model easier to reason about and test.

Expected internal pieces:

- period and range date window planning
- filtered usage `where` construction
- model-cost allocation helpers
- trend zero-fill helpers
- row-to-provider, row-to-model, and row-to-device response mappers

## Data Flow

Client flow:

1. The dialog owns range and filter state as it does today.
2. A range or filter change calls the shared grammar module to encode query params.
3. The dialog fetches the same endpoint with the encoded query.
4. Charts receive the same `MemberUsageDetail` response shape and selected filter state.
5. Toggle behavior stays the same:
   - selecting a provider clears selected models
   - selecting a model clears selected providers
   - device filters can combine with either providers or models
   - clearing filters returns to the unfiltered query

Server flow:

1. The route passes `request.nextUrl.searchParams` to the shared grammar parser.
2. The parser returns a normalized `MemberUsageQuery` or throws `MemberUsageQueryError`.
3. `getMemberUsageDetail` receives the normalized query.
4. The read model plans the date window and filtered aggregate reads internally.
5. The read model runs the existing aggregate reads.
6. The read model maps rows into the same `MemberUsageDetail` response shape.
7. The route returns the public response.

No behavior change is planned. A behavior change is acceptable only when it is a bug-level correction that makes the route response or UI filter behavior more obvious and functional.

## Error Handling

The grammar module is the single place that decides URL query validity.

Expected behavior:

- invalid range returns `400`
- invalid provider returns `400`
- invalid model returns `400`
- empty device returns `400`
- provider and model filters together return `400`
- unknown member returns `404`
- valid requests return the existing `MemberUsageDetail` schema

The dialog should use grammar helpers to avoid invalid normal UI combinations, but the server must still validate hand-edited URLs. The read model assumes a normalized query and does not translate validation errors. Unexpected Prisma or mapping errors should fail loudly.

## Testing

Grammar tests should cover:

- parsing current `range`, `period`, repeated `provider`, repeated `model`, and repeated `device` params
- encoding the same URL params the dialog sends today
- provider/model mutual exclusion
- selecting a provider clears models
- selecting a model clears providers
- device filters combine with either providers or models
- model keys split on the first colon only
- invalid filters keep the same `MemberUsageQueryError` messages and status

Dialog tests should cover user-visible behavior:

- range/filter changes send the expected endpoint URL through the grammar encoder
- selected provider/model/device toggles behave as before
- stale-while-refresh behavior remains covered
- low-level model-key construction is not duplicated in test setup where practical

Read-model tests should keep confidence in returned detail behavior:

- summary totals
- trend totals and zero-fill
- provider breakdown
- model breakdown
- device breakdown
- model-cost fallback behavior
- date windows
- provider, model, and device filters

Where query shape matters, keep focused query-planning assertions. Where behavior can be asserted from the returned `MemberUsageDetail`, avoid brittle exact Prisma call-order expectations.

Route tests should remain thin:

- expected `400` responses for invalid query input
- expected `404` response for unknown members
- success response validates against the existing schema
- detailed grammar cases stay in grammar tests instead of being repeated in route tests

Final verification should include:

- focused Member usage server tests
- focused Member usage component tests
- web typecheck
- full workspace test suite

## Implementation Notes

Use ordinary local module boundaries rather than forcing named design patterns. The maintainability pattern here is a shared grammar module plus a cohesive read model:

- one source of truth for filter grammar
- small pure helpers for policy and mapping
- a thin HTTP adapter at the route boundary
- behavior-oriented tests around public outputs

The preferred implementation order is:

1. Add grammar tests around the current server parser and desired client encoder behavior.
2. Extend `member-usage-query.ts` with encoding and filter-state helpers.
3. Move dialog URL construction and filter toggles onto grammar helpers.
4. Refactor read-model internals while preserving `getMemberUsageDetail(username, query, now)`.
5. Adjust read-model tests away from call-order coupling where practical.
6. Keep route response behavior stable except for explicitly justified bug-level improvements.

## Success Criteria

- Client and server no longer duplicate Member usage filter grammar.
- `getMemberUsageDetail` remains the single server read-model entry point.
- The read-model implementation is easier to scan because date planning, filtering, cost allocation, and response mapping are named pieces.
- Tests prove behavior at the grammar, dialog, route, and read-model boundaries.
- No unrelated architecture candidates are pulled into this implementation.
