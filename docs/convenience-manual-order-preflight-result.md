# Convenience Feature Result: Manual Order Preflight

## Implemented

- Added manual order preflight validation in `src/App.tsx`.
- Added a checklist that confirms the target market, required order inputs, ignored fields, market caution state, and live trading mode.
- Added estimated quote amount display for:
  - Limit orders with price and volume.
  - Market buys with buy amount.
  - Market sells when the selected ticker price is available.
- Blocked manual order submission when the preflight contains errors.
- Added `src/App.css` styles for the preflight panel and severity indicators.
- Updated `package.json` build script to use `vite build --configLoader runner` so Vite can load config inside the sandboxed worktree.

## Verification

- `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build`: passed
- `cargo check` in `src-tauri`: passed
- `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run tauri -- build --no-bundle`: passed

## Notes

- The plain `npm` shim in this sandbox points to a missing per-user npm CLI path, so verification used the installed Node npm CLI directly.
- A local `node_modules` junction to `D:\Workspace\repo_autobo\node_modules` was used for dependency resolution; it is ignored by Git.
- Full `tauri build` compiled the release app but failed during the final MSI WiX `light.exe` bundling step in this environment.
