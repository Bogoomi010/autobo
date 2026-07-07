# Automation 3 Feature Plan: Market Favorites

## Goal

Add a user convenience feature that lets traders pin frequently watched Upbit markets and switch the market list to favorites only.

## Non-overlap Check

- Existing work already covers automatic account linking from the `upbitkey` file and session-based private API calls.
- Existing UI already includes market search, quote-currency filtering, sorting, candle charting, and a separate asset window.
- This feature focuses on watchlist convenience and does not change account linking, order execution, or chart data behavior.

## Design

- Store favorite market codes in browser local storage under a stable app-specific key.
- Add a star toggle to each market row so users can add or remove a favorite without leaving the list.
- Add a favorites-only switch near the market filters.
- Keep favorites visible across app restarts and preserve normal search, quote filter, and sort behavior.
- Show an empty state when favorites-only mode is active and no favorite matches the current filters.

## Implementation Steps

1. Add favorite-market state, local storage hydration, and persistence in `src/App.tsx`.
2. Add a small helper to toggle favorites while preventing the row click from also changing markets.
3. Extend filtering so favorites-only mode composes with quote filters and search.
4. Add star controls and focused empty-state copy in the market list.
5. Add CSS for star buttons and favorite rows while keeping the current compact desktop layout.

## Verification Plan

- Run TypeScript/Vite build with `npm run build`.
- Run Rust tests with `cargo test` in `src-tauri`.
- Review Git diff to ensure changes are scoped to the feature and the required documentation.

## Implementation Result

- Added persistent favorite market storage with the `autobo.favoriteMarkets` local storage key.
- Added a favorites-only filter button in the market filter control.
- Added per-market star buttons beside each market row.
- Composed favorites with the existing quote filter, search input, and sorting logic.
- Added focused empty-state copy for favorites-only mode.
- Added CSS for favorite controls and favorite row highlighting.

## Verification Result

- `cargo test` from `src-tauri`: passed.
- `npm run build` through the default shell shim: failed because the local `npm` launcher pointed to missing `C:\Users\kbk56\AppData\Roaming\npm\node_modules\npm\bin\npm-cli.js`.
- `node node_modules\typescript\bin\tsc`: passed.
- `node node_modules\vite\bin\vite.js build`: passed.
- `C:\Program Files\nodejs\npm.cmd run build`: passed.
- Browser visual verification against `http://127.0.0.1:4175` was blocked by the browser plugin security policy, so no browser screenshot was captured.

## Commit and PR Result

- Working branch was `develop`, not detached HEAD.
- Creating `codex/automation-3-market-favorites` failed because Git could not create a nested ref path under `.git/refs/heads`.
- Creating `codex-automation-3-market-favorites` failed with permission denied while creating the branch ref lock.
- Standard `git add` failed because `.git/index.lock` could not be created.
- A fallback temporary index under the automation workspace also failed because Git could not add objects to `.git/objects`.
- No commit, push, PR, labels, or merge action was performed.
- Next action: fix repository `.git` write permissions for the automation user, then create a branch and commit the current working tree changes.
