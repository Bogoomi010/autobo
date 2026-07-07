# Automation 3 Feature Plan: Manual Order Presets

## Goal

Add a user convenience feature that reduces invalid manual order input combinations by letting users choose common Upbit order type presets.

## Non-overlap Check

- Existing automation work added market favorites and a favorites-only market filter.
- Existing UI already syncs the selected market into the manual order form.
- This feature focuses on manual order setup safety and speed, not market list navigation, favorites, asset viewing, or API key handling.

## Design

- Add compact preset buttons in the manual order panel.
- Provide presets for limit order, market buy, and market sell.
- When a preset is selected, update the manual order `side` and `ord_type` fields and clear fields that are invalid for that preset.
- Keep the existing detailed fields editable so advanced users can still adjust price, volume, identifier, and time-in-force.
- Highlight the active preset when the current manual order combination matches it.

## Implementation Steps

1. Add a `ManualOrderPreset` type and a preset application helper in `src/App.tsx`.
2. Add preset buttons above the manual order form.
3. Update CSS to fit the preset controls into the existing compact panel layout.
4. Run frontend build and Rust tests.
5. Record implementation and verification results in this document.

## Implementation Result

- Added a `ManualOrderPreset` type and active-preset detection for the manual order form.
- Added preset buttons for limit order, market buy, and market sell.
- Market buy preset sets `side=bid` and `ord_type=price`, clears volume, and clears time-in-force.
- Market sell preset sets `side=ask` and `ord_type=market`, clears price, and clears time-in-force.
- Limit preset sets `ord_type=limit` while preserving editable price and volume fields.
- Reused the existing segmented control styling so the preset buttons fit the current compact dashboard layout.

## Verification Result

- `npm run build`: failed because the default npm launcher points to missing `C:\Users\kbk56\AppData\Roaming\npm\node_modules\npm\bin\npm-cli.js`.
- `C:\Program Files\nodejs\npm.cmd run build`: passed.
- `cargo test` from `src-tauri`: passed.
- Local dev server at `http://127.0.0.1:4176`: responded with HTTP 200.
- Browser visual verification was blocked by the browser plugin security policy for `127.0.0.1:4176`; no browser screenshot was captured.

## Commit and PR Result

- Working branch was `develop`, not detached HEAD.
- Creating `automation-3-manual-order-presets` failed because Git could not create `.git/HEAD.lock` due to permission denied.
- Staging changed files failed because Git could not create `.git/index.lock` due to permission denied.
- No commit, push, PR, labels, merge, or auto-merge action was performed.
- Next action: fix repository `.git` write permissions for the automation user, then create a branch and commit the current working tree changes.
