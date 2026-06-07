# Member Usage Breakdown Filters Design

## Goal

The member usage dialog should let users filter the usage chart and Tokens/Cost summary by clicking the provider, model, and device breakdown rows below the chart.

## Current Constraint

The current member usage response includes:

- one aggregate trend for the selected date range
- provider summary rows
- model summary rows
- device summary rows

It does not include per-day trend buckets for each provider, model, or device. Because the chart needs filtered day-by-day values, filtering should be server-backed instead of trying to infer a filtered chart from the current aggregate response.

## Recommended Approach

Use server-refetch filtering.

- The dialog owns local filter state.
- Changing a filter reloads member usage detail with filter query parameters.
- The API returns a filtered summary and filtered trend.
- The breakdown lists remain visible and clickable so users can continue adding or removing filters.

This keeps the chart accurate, avoids sending a large all-buckets payload to the browser, and leaves the existing no-filter behavior unchanged.

## Filter Rules

- Providers are multi-select.
- Models are multi-select.
- Devices are multi-select.
- If no providers or models are selected, the chart shows all provider/model usage for the selected date range.
- Selecting a provider clears selected models.
- Selecting a model clears selected providers.
- Devices can combine with either providers or models.
- Selecting or deselecting a device does not clear providers or models.
- A clear action removes all active filters.

## Filter Semantics

Within a category, filters are inclusive:

- selected providers match `provider IN selectedProviders`
- selected models match any selected `(provider, modelName)` pair
- selected devices match `deviceId IN selectedDevices`

Across categories, filters are intersected:

- providers plus devices means selected providers on selected devices
- models plus devices means selected models on selected devices

If a model and device are selected together, the chart shows usage for that model on that device only.

## API Design

Extend the public member usage endpoint with optional filter query parameters:

- `provider=codex`
- repeated `provider` params for multiple providers
- `model=<provider>:<url-encoded-model-name>`
- repeated `model` params for multiple models
- `device=<device-id>`
- repeated `device` params for multiple devices

Model query values split on the first colon only. The text before the first colon is the provider, and the remaining text is the model name after normal URL decoding.

The existing `range=7d|30d` behavior remains required for dialog date windows. Existing `period=` behavior remains backward compatible for older callers.

The server validates:

- providers must be public provider enum values
- model filters must include both provider and model name
- device filters must be non-empty strings
- provider filters and model filters cannot both be applied in the same request

If both providers and models are submitted, the API returns a validation error. The client should avoid sending this state by clearing the other category immediately when users switch category type.

## Data Flow

The server applies filters to:

- summary aggregate
- daily trend aggregate
- provider breakdown
- model breakdown
- device breakdown

The breakdown lists should remain useful as controls:

- If a provider filter is active, provider rows still show available providers for the current date/device filter context.
- If a model filter is active, model rows still show available models for the current date/device filter context.
- If a device filter is active, provider/model rows are narrowed by selected devices.

This means users can see the active category and add or remove rows without the control list disappearing.

## UI Design

Use the existing member usage dialog layout:

1. Date range tabs stay at the top.
2. Summary cards follow the active filters:
   - Leaderboard Rank remains unchanged.
   - Tokens becomes the filtered token total.
   - Cost becomes the filtered cost total.
3. Active filter chips appear above the chart.
4. The chart shows the filtered trend.
5. Provider, model, and device rows below the chart become clickable filter controls.

Selected rows should be visually distinct and use `aria-pressed`.

## shadcn Components

Use shadcn patterns and docs during implementation.

- Use existing shadcn `Button` behavior for clickable breakdown rows.
- Add shadcn `Badge` if needed for active filter chips.
- Avoid custom one-off color styling; use semantic tokens and existing variants.
- Keep layout spacing with `gap-*`, not `space-*`.
- If adding new shadcn components, use `pnpm dlx shadcn@latest add <component>` and inspect the added source.

The implementation should reference shadcn docs for Button and Badge before coding the controls.

## Empty And Loading States

- If filters produce no usage, show the existing chart empty state with text adjusted to "No usage for these filters."
- Existing dialog loading and retry behavior remains.
- Filter clicks may show the current loading state while the server refetches.

## Testing

Add tests for:

- provider multi-select filters update the request URL and filtered summary/chart data
- model selection clears provider filters
- provider selection clears model filters
- device selection combines with provider filters
- device selection combines with model filters
- clear removes all filters and returns to unfiltered usage
- API rejects provider and model filters together
- server applies filters to summary and trend queries
- selected rows expose pressed state for accessibility

## Out Of Scope

- Persisting filters across dialog closes.
- Filtering the leaderboard table.
- Adding search inside the provider/model/device lists.
- Adding more chart types.
- Showing stacked bars by selected category.
