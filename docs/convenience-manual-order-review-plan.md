# Convenience Feature Plan: Manual order review

## Selected feature

Add a manual order review panel that summarizes the current order before submission and blocks clearly invalid order input combinations.

## Why this feature

- Manual order entry is the highest-risk repeated workflow in the app.
- Users currently need to mentally map `side`, `ord_type`, price, and volume before pressing submit.
- A local review panel reduces accidental orders without requiring account balance data or additional API calls.
- This does not overlap with the previous convenience feature that persisted screen preferences.

## Scope

- Show the selected market and resolved Korean/English market name when available.
- Show execution mode: dry-run or real order.
- Show a human-readable order type summary.
- Show the expected amount for limit orders when price and volume are both numeric.
- Show required-field and invalid-combination errors for:
  - limit orders without both price and volume
  - market buy (`bid` + `price`) without price
  - market sell (`ask` + `market`) without volume
  - unsupported `price` sell and `market` buy combinations
  - missing or malformed market code
- Disable manual order submission while blocking errors exist.
- Add a button to copy the current ticker price into the price field for limit-style entry.

## Out of scope

- Server-side Upbit validation parity.
- Balance, fee, and minimum-order checks.
- Automatic correction of user-entered order fields.
- Persisting additional fields beyond the existing preference persistence.

## Validation

- `npm run build`
- Manual code review of the disabled-button condition and order payload path.
