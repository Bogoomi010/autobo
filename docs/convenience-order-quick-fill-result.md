# Convenience Feature Result: Manual Order Quick Fill

## Implemented

- Added fixed quick-fill buttons for common market-buy KRW amounts: 10,000, 50,000, 100,000, and 500,000 KRW.
- Added sell-ratio buttons for 25%, 50%, and 100% of the selected asset's loaded available balance.
- Market-buy quick-fill prepares `side=bid`, `ord_type=price`, clears `volume`, and fills `price`.
- Market-sell quick-fill prepares `side=ask`, `ord_type=market`, clears `price`, and fills `volume`.
- Sell-ratio controls are disabled when the selected asset balance is not loaded.
- Order submission behavior was left unchanged.

## Files changed

- `src/App.tsx`
- `src/App.css`
- `docs/convenience-order-quick-fill-plan.md`
- `docs/convenience-order-quick-fill-result.md`

## Verification

- `npm run build`: passed in a D: build copy created from the current source files.
- Direct `npm run build` in the Codex worktree first failed because the worktree did not have `node_modules`; after using local dependencies, Vite still failed while loading config due sandbox access to upper `C:\Users\kbk56` path, not due a TypeScript or application error.
- `cargo check` in `src-tauri`: passed.

## Notes

- A temporary `.npm-cache` directory was created by the failed dependency install attempt and was not included in the commit scope.
- Local commit was created, but CLI push and PR creation were blocked because the sandbox could not connect to `github.com:443`.
