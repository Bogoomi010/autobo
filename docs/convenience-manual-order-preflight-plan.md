# Convenience Feature Plan: Manual Order Preflight

## Selected Feature

Add a manual order preflight panel that checks order shape before the user sends an order.

## Why This Feature

- Manual orders currently allow the user to send invalid or incomplete combinations and discover the issue only after invoking the backend.
- Upbit order fields change meaning by `side` and `ord_type`, so users need immediate guidance on which fields are required.
- This does not overlap with previous convenience work:
  - Preference persistence keeps screen state across launches.
  - Manual order quick fill focuses on faster value entry.
  - This feature focuses on validation, warnings, and send prevention before execution.

## Scope

- Validate the selected manual order before sending.
- Show a compact preflight checklist in the manual order panel.
- Disable the send button when required values are missing or invalid.
- Show an estimated order amount when it can be derived from price, volume, or current ticker data.
- Warn when the order is not in dry-run mode or the selected market has a caution flag.

## Validation Rules

- Market code must match the `QUOTE-BASE` format.
- Limit orders require both positive price and positive volume.
- Market buy (`side=bid`, `ord_type=price`) requires a positive buy amount and should not require volume.
- Market sell (`side=ask`, `ord_type=market`) requires a positive sell volume and should not require price.
- Other `side` and `ord_type` combinations are shown as caution states so users can review them before sending.

## Verification Plan

- Run `npm run build`.
- Run `cargo check` in `src-tauri`.
- Confirm the send button is gated by the preflight error state.
