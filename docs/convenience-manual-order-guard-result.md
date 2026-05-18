# Convenience Feature Result: Manual Order Guard

## Implementation

- Added a frontend manual order guard in `src/App.tsx`.
- The guard validates market code shape, invalid Upbit side/order-type combinations, and required positive numeric fields before submission.
- Added an inline order review panel that shows market, side, order type, required amount, and estimated notional when the UI can compute it.
- Disabled the manual order submit button while the current order is invalid.
- Kept the Rust backend order validation unchanged as the final safety layer.
- Updated `npm run build` to use Vite's runner config loader so the build can run inside the current sandbox path without esbuild trying to scan inaccessible parent directories.

## Verification

- `npm run build`: passed.
- `cargo check` in `src-tauri`: passed.
- `.\node_modules\.bin\tauri.cmd build --no-bundle`: passed and produced `src-tauri/target/release/autobo.exe`.
- `npm run tauri build`: frontend and release executable build passed, but MSI bundling failed at WiX `light.exe` in the local Tauri WiX toolchain.
