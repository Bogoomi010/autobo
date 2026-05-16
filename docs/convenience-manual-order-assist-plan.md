# Convenience Feature Plan: Manual Order Assist

## Selected Feature

Add a manual order assist panel that validates the current manual order form before submission and shows a concise order preview.

## Why This Feature

- Manual orders are the highest-risk repeated action in the app.
- Users currently need to remember which fields are required for each Upbit order type.
- A visible preview reduces trial-and-error and catches missing price or volume before invoking the order API.
- This does not overlap with the previous preference persistence feature.

## Scope

- Validate manual order inputs by order type:
  - `limit`: price and volume are required.
  - `price`: bid-side market buy, price is required.
  - `market`: ask-side market sell, volume is required.
  - `best`: bid requires price, ask requires volume, and time-in-force is recommended.
- Show the submit mode, market, order side/type, and expected notional amount when it can be calculated.
- Disable manual order submission while validation errors exist.
- Add a small action to copy the current ticker price into the limit price field.

## Non-Goals

- Do not change Upbit API request signing or backend behavior.
- Do not store additional secrets or private account data.
- Do not add a trade confirmation modal in this pass.

## Verification Plan

- Run `npm run build`.
- Run `cargo check` in `src-tauri`.
- Confirm TypeScript rejects no new nullable or enum handling errors.
