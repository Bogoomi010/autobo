# Convenience Feature Result: Manual order review

## Implemented

- Added a manual order review panel in the manual order card.
- The review panel shows:
  - dry-run or real-order mode
  - selected market name and code
  - human-readable order type
  - limit order price, volume, and estimated order amount
  - market buy amount or market sell volume
  - current ticker price when available
- Added local blocking validation for clearly invalid manual order inputs.
- Disabled the manual order submit button when blocking validation errors exist.
- Added a "current price" action that copies the latest ticker price into the price field.
- Added warning messages for values that are ignored by market order payloads and for real-order mode.

## Files changed

- `src/App.tsx`
- `src/App.css`
- `docs/convenience-manual-order-review-plan.md`
- `docs/convenience-manual-order-review-result.md`

## Validation result

- `node .\node_modules\typescript\bin\tsc --noEmit`: passed
- `npm run build`: passed from `D:\Workspace\repo_autobo\.automation-build\manual-order-review-53dd`
- `cargo check` in `src-tauri`: passed

## Notes

- Running `npm run build` directly in the Codex worktree failed because Vite/esbuild could not read a restricted parent directory while loading `vite.config.ts`.
- To verify the real frontend build, the current working tree was copied to a temporary build directory under `D:\Workspace\repo_autobo\.automation-build\manual-order-review-53dd`, where the same build script completed successfully.
