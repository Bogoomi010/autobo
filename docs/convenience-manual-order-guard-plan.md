# Convenience Feature Plan: Manual Order Guard

## Selected Feature

Add a manual order guard that validates the current order form before submission and shows a concise order review.

## Why This Feature

- Manual order submission is the highest-risk repeated action in the current UI.
- Existing convenience work already covers saved screen preferences and input restoration, so this feature avoids overlap.
- The backend validates orders, but the user only sees the error after pressing submit. A frontend guard gives immediate feedback and prevents avoidable invalid requests.

## Scope

- Validate manual order market code, side, order type, and required numeric fields.
- Block submission for invalid combinations that the backend already rejects:
  - `limit` requires price and volume.
  - `bid + price` requires price.
  - `ask + market` requires volume.
  - `bid + market` and `ask + price` are invalid Upbit combinations.
- Show a compact review panel with action, order type, market, required amount, and estimated notional when it can be computed.
- Keep the backend validation intact as the final safety layer.

## Non-Goals

- Do not change API authentication, order signing, or backend request behavior.
- Do not store any additional sensitive information.
- Do not implement balance-aware validation because the account chance response shape is not normalized in the UI yet.

## Verification Plan

- Run `npm run build`.
- Run `cargo check` in `src-tauri`.
- Verify TypeScript catches no new type issues.
