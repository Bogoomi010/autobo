# Convenience feature result: recent market quick switch

## Implemented

- Added recent market persistence with `autobo.recentMarkets`.
- Recent history stores only valid market codes, normalizes to uppercase, and keeps the latest 8 entries.
- Added a compact quick-switch strip in the market list panel.
- Quick-switch entries show market name, code, and change rate when ticker data is available.
- Added a Clear action for removing recent market history.
- Kept this feature separate from favorites and screen preference persistence.

## Files changed

- `src/App.tsx`
- `src/App.css`
- `docs/convenience-recent-markets-plan.md`
- `docs/convenience-recent-markets-result.md`

## Verification

- `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build -- --configLoader runner`: passed
- `node .\node_modules\typescript\bin\tsc`: passed
- `node .\node_modules\vite\bin\vite.js build --configLoader runner`: passed
- `cargo check` in `src-tauri`: passed

## Notes

- The default `npm.cmd` in this environment points at a missing user-level npm CLI path, so verification used the npm CLI bundled under `C:\Program Files\nodejs`.
- The plain Vite config bundler hit a sandbox read restriction when using a junctioned dependency directory; `--configLoader runner` avoided that environment-specific issue.
