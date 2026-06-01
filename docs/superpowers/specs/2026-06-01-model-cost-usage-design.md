# Model and Cost Usage Design

## Summary

Token Burn should keep the current aggregate-only privacy model while adding richer daily usage detail for future displays. The CLI will continue to use `ccusage` as the source of truth, but it will preserve model names, per-model token totals, reasoning token totals, and USD cost estimates when `ccusage` reports them.

The server will store daily provider totals as it does today, plus child rows for daily per-model usage. Public leaderboard behavior does not change in this feature; the new data exists for future provider/model/cost breakdowns, member diagnostics, and historical charts.

## Goals

- Store model-level daily token usage for Claude Code and Codex when available from `ccusage`.
- Store daily cost estimates in USD when available from `ccusage`.
- Store reasoning output tokens as a first-class token category.
- Preserve aggregate-only privacy boundaries: no prompts, commands, project paths, file paths, raw sessions, or conversation contents.
- Keep leaderboard scoring based on token totals unless a later product decision changes it.
- Make repeated syncs idempotent by upserting per device, provider, date, and model.

## Non-Goals

- Build an independent pricing engine in Token Burn.
- Recalculate historical cost if upstream pricing changes.
- Store raw session or project-level usage.
- Display the new model/cost data publicly as part of this change.
- Support providers beyond the current `claude_code` and `codex` scope.

## Source Data

The CLI already runs `ccusage <provider> daily --json --timezone UTC`. `ccusage` reports daily token totals and, for supported providers, cost and model detail.

Codex daily JSON includes daily fields such as:

- `costUSD`
- `models`
- `inputTokens`
- `outputTokens`
- `cachedInputTokens`
- `reasoningOutputTokens`
- `totalTokens`

Codex per-model entries include fields such as:

- `inputTokens`
- `outputTokens`
- `cachedInputTokens`
- `reasoningOutputTokens`
- `totalTokens`
- `isFallback`

Claude Code supports `--breakdown` for per-model cost breakdowns. The CLI should enable provider-specific arguments that expose the richest aggregate daily JSON available, while still grouping by UTC date.

## Data Model

`DailyProviderUsage` remains the parent aggregate row. It should gain these nullable fields:

```prisma
costUsd        Decimal? @db.Decimal(18, 6)
costSource     String?
costMetadata   Json?
sourceSnapshot Json?
```

Meanings:

- `costUsd`: the daily provider cost in USD as reported by `ccusage`.
- `costSource`: initially `ccusage`.
- `costMetadata`: provider-specific cost context, such as Codex speed tier or offline pricing mode if available.
- `sourceSnapshot`: optional aggregate-only source row from `ccusage`, with sensitive or unstable data excluded. This preserves future flexibility without storing prompts or sessions.

Add a child table for daily model totals:

```prisma
model DailyModelUsage {
  id                   String   @id @default(cuid())
  dailyProviderUsageId String
  memberId             String
  deviceId             String
  provider             String
  date                 DateTime @db.Date
  modelName            String
  tokenCategories      Json
  totalTokens          BigInt
  costUsd              Decimal? @db.Decimal(18, 6)
  metadata             Json?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  dailyProviderUsage DailyProviderUsage @relation(fields: [dailyProviderUsageId], references: [id], onDelete: Cascade)
  member             Member             @relation(fields: [memberId], references: [id], onDelete: Cascade)
  device             Device             @relation(fields: [deviceId], references: [id], onDelete: Cascade)

  @@unique([deviceId, provider, date, modelName])
  @@index([memberId, date])
  @@index([provider, modelName, date])
}
```

`DailyProviderUsage` should also expose a relation:

```prisma
models DailyModelUsage[]
```

`Member` and `Device` may expose `modelUsage DailyModelUsage[]` relations if useful for Prisma navigation.

## Sync Payload

Extend the shared sync schema with optional cost and model data:

```ts
{
  provider: "claude_code" | "codex";
  date: "YYYY-MM-DD";
  tokenCategories: Record<string, number>;
  totalTokens: number;
  costUsd?: number;
  costSource?: "ccusage";
  costMetadata?: Record<string, unknown>;
  sourceSnapshot?: Record<string, unknown>;
  models?: Array<{
    modelName: string;
    tokenCategories: Record<string, number>;
    totalTokens: number;
    costUsd?: number;
    metadata?: Record<string, unknown>;
  }>;
  deviceId: string;
  deviceName: string;
  cliVersion: string;
  ccusageVersion: string;
  os: "darwin" | "linux" | "win32";
  syncedAt: string;
}
```

Validation rules:

- `totalTokens` must equal the sum of top-level `tokenCategories`.
- Each model `totalTokens` must equal the sum of that model's `tokenCategories`.
- Cost values must be finite, non-negative numbers no greater than 1,000,000 USD per daily provider or model row.
- `modelName` must be non-empty and bounded in length.
- Unknown token categories are allowed so newer `ccusage` fields can pass through.
- Unknown providers remain rejected.

The token categories should include the existing categories and add `reasoningOutput`:

- `input`
- `output`
- `cacheCreate`
- `cacheRead`
- `reasoningOutput`

## CLI Behavior

The CLI should continue reading daily UTC reports, but normalization should preserve richer aggregate fields.

Provider command choices:

- Codex: `ccusage codex daily --json --timezone UTC`, with cost data accepted from `costUSD`.
- Claude Code: `ccusage claude daily --json --timezone UTC --breakdown`, if the JSON output includes usable per-model breakdowns. If `--breakdown` output shape is incompatible, the CLI should still sync provider-level cost/tokens and omit model rows for that provider.

Normalization should:

- Map `cachedInputTokens` to `cacheRead`.
- Map `reasoningOutputTokens` to `reasoningOutput`.
- Map cost fields like `costUSD` to `costUsd`.
- Convert `models` objects into sorted model rows.
- Keep model metadata small and aggregate-only, for example `isFallback`.
- Omit model rows when no model data exists rather than failing the whole provider.

The CLI should not calculate model cost itself unless `ccusage` explicitly reports enough per-model cost values. If a provider reports total cost but no per-model cost, store only the parent `DailyProviderUsage.costUsd`.

## Server Behavior

The sync endpoint should continue authenticating the CLI token and upserting the device first. It should then upsert the parent `DailyProviderUsage` row and replace the model rows for that parent snapshot.

Recommended persistence flow:

1. Validate the extended payload.
2. Upsert `Device`.
3. Upsert `DailyProviderUsage`.
4. Delete existing `DailyModelUsage` rows for that device/provider/date.
5. Create the submitted model rows linked to the parent usage row.
6. Update `CliToken.lastUsedAt`.

Deleting and recreating child model rows keeps sync idempotent and avoids stale model rows if a later `ccusage` run changes the set of models for the same day.

## Privacy and Safety

The new fields are still aggregate-only. The implementation must not send or store:

- prompts
- command text
- session IDs
- project names or paths
- file paths
- raw conversation logs
- GitHub OAuth tokens
- raw CLI tokens

`sourceSnapshot`, if implemented, must be limited to the daily aggregate row and should exclude nested fields that are not needed for aggregate analytics. If there is doubt about a field's sensitivity, do not include it.

## Future Displays Enabled

This data enables future pages or filters such as:

- provider breakdown by period
- model breakdown by period
- daily cost charts
- total cost leaderboards
- token category charts, including reasoning output
- member-only device/model diagnostics
- most expensive model used summaries

No display work is included in this design.

## Error Handling

- If cost is missing, sync tokens and leave cost fields null.
- If model breakdown is missing, sync the parent daily provider row and omit child model rows.
- If a model row is malformed but parent totals are valid, fail that provider snapshot rather than storing partial model data.
- If `ccusage --breakdown` fails only for Claude Code, fall back to the standard daily report for Claude Code and omit model rows.
- If server validation fails, return the existing invalid payload response and let the CLI record the provider failure.

## Testing

Shared schema tests should cover:

- payloads with cost and model rows
- reasoning output token categories
- rejection of negative cost
- rejection of model totals that do not match model token category sums
- backward compatibility for payloads without cost/model fields

CLI tests should cover:

- Codex daily JSON with `costUSD` and `models`
- Claude Code daily JSON with per-model breakdown if supported
- missing cost/model data
- malformed model totals
- source snapshots excluding sensitive fields

Web/API tests should cover:

- storing parent cost fields
- replacing child model rows on repeated sync
- accepting payloads without model rows
- preserving existing leaderboard totals
- rejecting invalid cost/model payloads

## Migration and Compatibility

Existing `DailyProviderUsage` rows remain valid because new parent fields are nullable. Existing CLI clients can keep syncing the old payload shape until users upgrade. New CLI clients can send cost/model fields to upgraded servers.

The server should accept payloads with no model rows so rollout can be gradual. The first deployment should update the web/API and database before publishing the CLI with extended payloads.
