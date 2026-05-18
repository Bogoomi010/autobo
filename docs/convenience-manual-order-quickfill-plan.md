# Convenience Feature Plan: Manual Order Quick Fill

## Selected Feature

Add quick-fill controls to the manual order panel so users can populate common price, buy amount, and sell volume values without doing repeated calculations outside the app.

## Why This Feature

- Manual orders currently require users to copy the current price and calculate buy totals or sell quantities by hand.
- The app already fetches ticker and order chance data, so the UI can reuse available data without adding a new backend endpoint.
- This does not overlap with the previous preferences persistence work; it improves the active ordering workflow.

## Scope

- Show a compact quick-fill area in the manual order panel.
- Provide current-price based limit price buttons: current price, 1% below, and 1% above.
- Provide buy amount buttons: market minimum when known, 10,000 KRW, 50,000 KRW, and 100,000 KRW.
- Provide sell volume buttons from the order chance ask balance when available: 25%, 50%, and 100%.
- Keep all controls disabled or hidden when their source data is unavailable.

## Out Of Scope

- No automatic trading rule changes.
- No storage of API keys or private account data.
- No new backend commands.
- No live order preview simulation beyond filling existing fields.

## Implementation Plan

1. Add lightweight TypeScript types and helpers for order chance data parsing.
2. Add memoized quick-fill values derived from `ticker` and `chance`.
3. Add handlers that update only the relevant manual order fields.
4. Add the quick-fill UI inside the manual order panel.
5. Add compact CSS for the quick-fill area.

## Verification Criteria

- `npm run build` passes.
- Existing order validation and dry-run flow remain unchanged.
- Quick-fill controls do not appear when source data is missing.
