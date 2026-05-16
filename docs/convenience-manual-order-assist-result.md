# Convenience Feature Result: Manual Order Assist

## Implemented

- Added a manual order assist model in `src/App.tsx`.
- The assist model validates the current manual order by `ord_type` and `side`.
- The manual order panel now shows:
  - submit mode
  - market
  - side/order type
  - estimated notional amount
  - estimated quantity
  - validation issues and warnings
- Manual order submission is disabled while validation issues exist.
- The submit handler also blocks invalid orders as a defensive check.
- Added a `Use ticker price` action to fill the price field from the latest ticker.
- Updated the Vite build script to use `--configLoader runner`, avoiding config bundling access failures in this worktree.

## Verification

- `npm run build`: passed
- `cargo check` in `src-tauri`: passed

## Notes

- The default `npm` shim in this sandbox points to a missing user-level npm CLI. Verification used the installed Node npm CLI directly:
  `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build`
- The feature does not store additional user data and does not change backend order signing or request behavior.
