# Convenience Feature Result: Manual Order Quick Fill

## Implemented

- Added quick-fill controls to the manual order panel.
- Added current-price based limit price buttons:
  - Current price
  - 1% below current price
  - 1% above current price
- Added market-buy amount buttons:
  - Minimum order amount from order chance data when available
  - 10,000 KRW
  - 50,000 KRW
  - 100,000 KRW
- Added market-sell volume buttons from order chance ask balance when available:
  - 25%
  - 50%
  - 100%
- Kept the existing manual order validation, dry-run handling, and preference persistence flow unchanged.

## Files Changed

- `src/App.tsx`
- `src/App.css`
- `docs/convenience-manual-order-quickfill-plan.md`
- `docs/convenience-manual-order-quickfill-result.md`

## Verification

- `npm run build -- --configLoader runner`: passed
- `cargo check` in `src-tauri`: passed

## Repository Status

- Local branch: `automation/convenience-20260516-asset-shortcuts`
- Local commit created.
- Push and PR creation were blocked because this sandbox could not connect to `github.com:443`.

## Notes

- The initial plain `npm run build` path was blocked in this sandbox because Vite's default config bundler tried to read a restricted parent directory. The equivalent build script with Vite's runner config loader passed.
- npm dependency installation from the registry was also blocked by network sandboxing, so verification reused the same project's existing local dependency set from `D:\Workspace\repo_autobo\node_modules`.
