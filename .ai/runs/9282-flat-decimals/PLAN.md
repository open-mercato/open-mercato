# Issue 9282

1. [x] Triage: both flat price forms forward trimmed user text; API canonical decimal validation rejects commas. No open/closed PR or main commit found for 9282.
2. [x] Root cause: create buildPricePayload and edit buildUpdatePayload bypass shared parseLocaleNumber. Normalize only typed net/gross before createCrud/updateCrud; reject malformed/negative amounts through localized createCrudFormError. Preserve API validators, record normalization, version header and delete behavior.
3. [x] Implement common form-only amount helper, both call sites, translated errors, unit and self-contained browser regressions.
4. [x] Run targeted tests and configured gate, report environment limits.
5. [x] Commit and publish PR #9339; post static review and explicit UI/gate blockers, release claims. Parent must obtain independent review and financial QA.

— PREVIOUS STEP (om-root-cause) said —
Summary: Flat price-rule forms reject comma-decimal monetary input.

Root cause: Both buildPricePayload (create/page.tsx) and buildUpdatePayload ([id]/edit/page.tsx) send trimmed unitPriceNet/unitPriceGross strings unchanged. Canonical API validation rejects 12,50, inferred directly from source and issue QA evidence.

Files to change:
- packages/core/src/modules/catalog/backend/catalog/prices/create/page.tsx — normalize typed amounts using locale.
- packages/core/src/modules/catalog/backend/catalog/prices/[id]/edit/page.tsx — same, preserving optimisticLockUpdatedAt.
- packages/core/src/modules/catalog/components/prices/priceFormAmounts.ts — shared parsing and localized field refusal.
- packages/core/src/modules/catalog/components/prices/__tests__/priceFormAmounts.test.ts — decimal/malformed/negative/zero regressions.
- packages/core/src/modules/catalog/i18n/{en,pl,de,es,ko}.json — localized refusal.
- packages/core/src/modules/catalog/__integration__/TC-CAT-PRICES-004-localized-flat-prices.spec.ts — owned fixtures, save/reload, invalid preservation, stale edit and repeat saves.

Approach: Apply shared parseLocaleNumber only to form text immediately before submission. Keep blank optional values omitted, zero valid and canonical API/database validation unchanged.

Risks: Locale parsing must not change magnitude; pin three-decimal inputs and dot input under Polish. Persisted values stay canonical on load, and locking remains managed by CrudForm.
