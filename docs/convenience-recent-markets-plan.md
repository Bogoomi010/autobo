# Convenience feature plan: recent market quick switch

## Selected feature

Add a recent market quick-switch area to the market list panel.

## Why this feature

- Users often jump between the same few trading pairs while comparing prices, charts, and manual order inputs.
- Favorites are useful for explicit long-term watchlists, but users also need a short automatic history for temporary comparisons.
- This is a functional convenience improvement and does not overlap with the existing screen preference persistence work.

## Scope

- Track valid selected market codes in browser localStorage.
- Keep the most recent selected market first.
- Limit the history to 8 entries.
- Render quick-switch buttons above the full market list.
- Allow users to clear the recent market history.

## Non-goals

- Do not store API keys, account data, orders, logs, or strategy runtime state.
- Do not replace the existing favorites feature.
- Do not change Upbit API requests or trading behavior.

## Implementation plan

1. Add a dedicated recent markets storage key and load/save helpers in `src/App.tsx`.
2. Add React state for recent markets and update it when the selected market changes to a valid market code.
3. Build lightweight display metadata from loaded market names and tickers when available.
4. Insert a compact quick-switch strip in the market list panel.
5. Add CSS for compact, stable recent market buttons.

## Verification criteria

- `npm run build` passes.
- Recent market tracking ignores malformed market input.
- Recent markets use a separate storage key from favorites and user preferences.
