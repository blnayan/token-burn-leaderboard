# Seamless Member Usage Refresh Design

## Goal

Filter clicks in the member usage dialog must keep the chart and summary visible while filtered data is loading, avoiding the current blank/skeleton flash.

## Design

The dialog will use a stale-while-refresh loading state. The first load for a member still shows the existing skeleton. Once a successful detail payload exists, later range/filter/retry requests keep that detail mounted while the request is pending. Filter state updates immediately so chips and pressed rows reflect the user's click, while the old chart remains visible until the new API response replaces it.

If a refresh fails after data already exists, the dialog keeps the last successful chart visible and shows the retryable error message above it. If the initial load fails before any data exists, the dialog keeps the existing error-only behavior.

## Testing

`member-usage-dialog.test.tsx` will cover that a pending filter request does not unmount the existing summary/chart controls. Existing loading and retry tests continue to cover initial load and error behavior.
