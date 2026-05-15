# Convenience feature result: recent market quick switcher

## Implemented

- Added recent market persistence with `autobo.recentMarkets`.
- Stores up to 8 valid market codes, newest first.
- Deduplicates malformed or repeated entries when loading from storage.
- Updates the recent list whenever the active normalized market becomes a valid market code.
- Added recent market chips under the main market input.
- Added a clear action for the recent market list.
- Kept recent markets separate from favorites and general screen preferences.

## Files changed

- `src/App.tsx`
- `src/App.css`
- `docs/convenience-recent-markets-plan.md`
- `docs/convenience-recent-markets-result.md`

## Verification results

- `cargo check` in `src-tauri`: passed.
- `npm run build`: passed from a temporary copy under `D:\Workspace\repo_autobo\.codex-build-a7c8`.

## Verification notes

- Running `npm run build` directly in the Codex worktree reached the TypeScript stage successfully, then Vite failed while loading `vite.config.ts` because the sandbox denied parent-directory access from the `C:\Users\kbk56\.codex\worktrees\...` path.
- The same source files built successfully from the temporary `D:\Workspace\repo_autobo` path using the same package scripts.
- The temporary build folder and copied dependency/cache folders were cleanup candidates after verification.
