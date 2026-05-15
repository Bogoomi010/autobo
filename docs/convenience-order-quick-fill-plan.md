# Convenience Feature Plan: Manual Order Quick Fill

## Selected feature

Add quick-fill controls to the manual order panel so users can fill common market-buy amounts and market-sell quantities without repeatedly calculating or typing values.

## Why this feature

- Manual orders are one of the highest-friction workflows in the app.
- Upbit market buy orders use `ord_type=price` with a KRW amount, while market sell orders use `ord_type=market` with a volume. Users must remember and type different fields for each side.
- The previous automation already implemented persisted screen preferences, so this feature avoids overlap and targets functional convenience.

## Scope

- Add fixed market-buy amount buttons for common KRW order sizes.
- Add sell-ratio buttons that calculate 25%, 50%, and 100% of the selected asset's available balance from the loaded session accounts.
- Keep API keys and private data handling unchanged.
- Keep order submission behavior unchanged; quick-fill only prepares form values.

## Implementation plan

1. Add helpers for safely reading asset accounts from the existing private account response.
2. Derive the selected market's base currency and available balance.
3. Add quick-fill callbacks for market buy amount and market sell ratio.
4. Render quick-fill controls inside the manual order panel.
5. Add scoped CSS for compact, stable quick-fill controls.

## Verification criteria

- `npm run build` passes.
- Quick-fill does not alter order placement logic.
- Sell ratio buttons remain disabled when the selected asset balance is unavailable.
