# Variant price locale display

Issue: #10006
Source doc: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md

## Goal

Show saved catalog variant prices and empty-field hints in the selected UI locale, padded to the currency display digits without rounding stored or edited amounts.

## Scope

The existing VariantPricesSection and a local input component. Use the shared decimal, currency-display and locale-separator helpers. Preserve the price draft and API contracts, validation, optimistic locking and mutation flow. No new dependencies or schema changes.

## Implementation Plan

### Phase 1: Exact localized display

1. Add a buffered price input that localizes loaded values, trims storage padding, pads display decimals, preserves extra precision and leaves partial/invalid edits untouched while focused.
2. Wire it into VariantPricesSection. Cover real component input/blur/rerender behavior and the variant edit round trip with self-contained fixtures.
3. Run focused tests, generation/build/type checks and review. Publish a ready PR with validation limitations and UI evidence when available.

## Risks

Formatting on every keystroke would move the cursor or discard a trailing separator. Format initial/external values and blur only. Formatting must never update the draft just by rendering or focusing. High-precision and unknown-currency values must retain every significant digit. Scope is a display follow-up under the existing money spec, not a change to precision rules.

## Progress

- [ ] 1.1 Implement exact localized display without editing the draft.
- [ ] 1.2 Add component regressions and variant-page round-trip coverage.
- [ ] 1.3 Validate, review and publish with accurate evidence.
