# Checkpoint 1 — Steps 1.1–2.2

**Runner:** local mode (no compose `app` container running).

| Check | Result |
|-------|--------|
| `yarn generate` | ✅ exit 0 |
| `yarn i18n:check-sync` | ✅ all locales in sync |
| `yarn i18n:check-usage` | ✅ exit 0 (advisory unused-key count only) |
| `yarn typecheck` | ✅ 42/42 tasks |
| jest `customer_groups` + `ecommerce/lib` | ✅ 50 suites, 724 tests |
| `yarn db:generate` (schema-diff probe) | ✅ `customer_groups: no changes`; regenerated from the pre-change snapshot the SQL is byte-identical to the terms half of reference `Migration20261026144220` (up and down). Unrelated `forms`/`wms` drift discarded |
| `ecommerce` `buyerContext.test.ts` | ✅ untouched (`git diff 3261760b4d -- packages/core/src/modules/ecommerce` empty) and passing |
| Integration `TC-CGRP` (ephemeral env) | ✅ 37 passed (11.3m) — `checkpoint-1-artifacts/playwright.log` |
| UI screenshots | `checkpoint-1-artifacts/terms-form-missing-currency-warning.png` (threshold set, no currency → warning), `terms-form-saved-after-reload.png` (four fields persisted after reload) |
