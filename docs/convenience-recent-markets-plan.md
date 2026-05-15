# Convenience feature plan: recent market quick switcher

## Selected feature

Add a recent market quick switcher that automatically remembers the latest valid markets the user selected or typed, then exposes them as one-click chips near the market selector.

## Why this feature

- Users often move between a small set of markets while checking charts, balances, and order conditions.
- Favorite markets already require explicit manual curation. Recent markets reduce repeat typing and searching without changing the user's favorite list.
- The feature is functional convenience first: it shortens market switching across the whole app because the selected market drives ticker, chart, strategy, and manual order context.

## Scope

- Store up to 8 valid market codes in `localStorage`.
- Add the active normalized market to the top of the recent list when it changes.
- Render recent market chips below the main market input.
- Clicking a chip switches the selected market.
- Provide a clear action for the recent list.
- Do not store API keys, account data, order responses, logs, or running automation state.

## Implementation plan

1. Add a storage key, max count, and safe load/save helpers in `src/App.tsx`.
2. Add `recentMarkets` state initialized from storage.
3. Update recent markets when `normalizedMarket` is valid.
4. Render recent market chips in the top market band.
5. Add compact CSS for the recent market row and chips.
6. Record implementation and verification results after build/test.

## Verification

- `npm run build`
- `cargo check` from `src-tauri`
