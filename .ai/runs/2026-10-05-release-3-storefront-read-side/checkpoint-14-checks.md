# Checkpoint 14 — steps 7.6–7.10 + 7.7-fix (admin UI tabs, group-terms pickers)

**Timestamp:** 2026-10-06T18:03:17Z
**Steps covered:** 7.6–7.10, 7.7-fix (3d7ab5aed2 .. ff2cfeffce)
**Runner:** local mode (`LANG=en_US.UTF-8`) for build/typecheck/unit/lint; ephemeral env (fresh forced build + own DB; re-run on a rebuild incl. ff2cfeffce, started ~18:5xZ) for the UI smoke
**Touched areas:** store edit tabs Branding (sandboxed srcdoc preview), Domains (+ domain-mapping enricher, read-only `GET /api/ecommerce/domain-mappings`), Channels (scope pickers, require_authentication, price_sort_fallback, live count), SEO; customer_groups group-terms assortment pickers; generic catalog lookup pickers moved to `packages/ui/src/backend/inputs` (ecommerce paths re-export).

| Check | Result | Notes |
|---|---|---|
| `yarn build:packages --force` → `yarn generate` → `yarn build:packages --force` | ✅ | |
| typecheck core + ui | ✅ | |
| `yarn workspace @open-mercato/core test` (FULL, before 7.7-fix) | ✅ 19973 passed | after 7.7-fix: ecommerce 768 ✅ (incl. new enricher-wiring guard; fails without the fix) |
| `yarn workspace @open-mercato/ui test` (FULL) | ✅ 2505 passed | |
| `yarn i18n:check-sync` | ✅ | |
| `yarn lint` | ✅ | |
| UI smoke — Branding | ✅ | valid oklch updates swatch + preview; invalid colour → field error, no PUT; save 200, persisted after reload |
| UI smoke — Domains | ❌ → ✅ | first run: every row "details unavailable"/Unknown — route never opted into the 7.7 enricher → **7.7-fix**. Re-run: `_domainMapping` in the API; hostname, status badge, last DNS check, per-status warning; `dns_failed` shows reason; deleted mapping → "Domain removed" diagnostic with the customer_accounts link; delete confirm names the hostname |
| UI smoke — Channels | ✅ | default binding 201; count 7 → 2 with a category included; require sign-in → "0 for anonymous visitors … 2 without"; fallback `unavailable` consequence text; persisted; new binding shows "save to see the count" |
| UI smoke — SEO | ✅ | all fields persist; invalid token → field error, no PUT; clearing site name saves (200) and stays empty |
| UI smoke — group terms | ✅ | include category + exclude tag persisted; clearing all saves `assortmentScope: null` |
| Console | ✅ | only the pre-existing post-login feature-check 401 / dashboard-layout fetch abort |

**Artifacts:** `checkpoint-14-artifacts/` — screenshot-branding-tab.png, screenshot-domains-tab.png (dns_failed state), screenshot-domains-removed.png, screenshot-channels-dialog.png, screenshot-channels-tab.png, screenshot-seo-tab.png, screenshot-group-terms-assortment.png.

**Executor rescue in this window:** 7.9 (cheap tier) produced a separate docs-flip commit, did not push, and sent `null` for cleared SEO fields (server 400) — unpushed commits un-committed and re-done by a standard-tier rescue (3300e50119). See NOTIFY.
**Low-severity findings for the review pass:** include-categories suggestion list stays open after a pick; Channels table overflows horizontally (Products shown clipped); price-kind suggestion list open on load in group terms; plus checkpoint 13's duplicate Cancel per card and stale undo banner after Archive.
**Review notes:** `packages/ui` lookup sources hard-code `/api/catalog/*` paths (chosen to avoid cross-module component imports); new read-only `GET /api/ecommerce/domain-mappings` lets `ecommerce.stores.view` holders list their organization's domain mappings without the customer_accounts domain feature; US-E1 empty-intersection warning not built (no cheap data source); logo/favicon are URL fields (no upload contract).
