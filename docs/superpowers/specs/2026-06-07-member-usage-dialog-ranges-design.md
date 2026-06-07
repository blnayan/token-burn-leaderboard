# Member Usage Dialog Ranges Design

## Goal

The member usage dialog should show chart data for explicit recent date windows instead of inheriting the leaderboard filter. A user clicking any leaderboard member should be able to inspect usage for the past 7 days or past 30 days from inside the dialog.

## User Experience

- The dialog opens with **Past 7 days** selected.
- The dialog includes a compact two-option control with **Past 7 days** and **Past 30 days**.
- Changing this control reloads the dialog's usage data.
- Leaderboard filters remain unchanged and do not affect dialog chart or summary data.
- Daily and all-time are not available in the dialog.
- Chart bars use Tailwind blue values through the shadcn chart configuration so the bars remain visible and consistent in dark mode.

## Data Flow

- The dialog owns its selected usage range as local client state.
- The selected range is sent to the member usage endpoint as a dialog-specific range value.
- The server aggregates member usage over the requested trailing UTC date window:
  - `7d`: past 7 days
  - `30d`: past 30 days
- Existing leaderboard period behavior remains unchanged for the leaderboard table and any existing API consumers.

## UI Components

- Reuse the existing shadcn dialog, card, skeleton, and chart components.
- Use an existing shadcn option-control pattern for the two dialog ranges, preferring an installed component to avoid unnecessary new UI surface.
- Use shadcn chart theme configuration with Tailwind blue CSS variables:
  - light theme: Tailwind blue 500
  - dark theme: Tailwind blue 400

## Error Handling

- Existing loading, error, and retry behavior remains in place.
- Changing the range while the dialog is open should show the loading state and fetch the newly selected range.
- Invalid range values should be rejected by the API with a validation error.

## Testing

- Add or update shared schema tests for the new dialog range values.
- Add or update server aggregation tests for 7-day and 30-day member usage windows.
- Add or update web component tests to confirm:
  - the dialog defaults to Past 7 days
  - Past 30 days can be selected
  - fetch requests use the dialog range instead of the leaderboard period
  - the chart config uses Tailwind blue values

## Out of Scope

- Changing leaderboard table filters.
- Adding daily or all-time options to the dialog.
- Persisting the selected dialog range across browser sessions.
- Adding new chart types.
