# Final gate — all Tasks rows done (1.1 .. 7.12-ui-fix)

**Timestamp:** 2026-10-07
**HEAD verified:** 8dc28f8468 (validation re-run + full integration suite both ran on this commit)
**Runner:** local mode (no compose `app` container running; `LANG=en_US.UTF-8`), ephemeral env for integration

## 1. Full `validation.commands` gate

First run (on 9435edbb3d) failed `open-mercato-docs#test`: the notification-registry docs test found the two new `ecommerce.store.*` notification types missing from `notification-delivery.mdx` → **7.12-gate-fix** (ffe3a3dceb). The style pass then added 7.12-ds-fix and 7.12-ui-fix, so the whole gate was re-run on the final HEAD:

| Command | Result | Notes |
|---|---|---|
| `yarn build:packages` (`--force`) | ✅ 38/38 | |
| `yarn generate` | ✅ | |
| `yarn build:packages` (`--force`) | ✅ 38/38 | |
| `yarn i18n:check-sync` | ✅ | |
| `yarn i18n:check-usage` | ✅ (advisory) | pre-existing unused-key report only |
| `yarn typecheck` | ✅ 38/38 | |
| `yarn test` | ⚠️ 46/47 | only `create-mercato-app#test` fails: 810 pass / 80 fail of 897, every failure `bwrap: setting up uid map: Permission denied` (host sandbox; develop baseline 81 on the same suites). Not a regression. |
| `yarn build:app` | ✅ | |

## 2. Full integration suite (`yarn test:integration`, 1.3h)

Result on HEAD 8dc28f8468, attached to a freshly started ephemeral env: **2411 passed, 8 failed, 4 flaky, 75 skipped**. All TC-ECOM-*, TC-CAT-OMNI-*, catalog, customer_groups, translations and search specs passed.

None of the 8 failures is in a module this PR changes. Triage:

| Spec | Failure | Classification |
|---|---|---|
| TC-SX-001 (sync_excel import) | worker ENOENT on the uploaded file under `<root>/storage/...` | **Environmental (attached mode)**: the test process lacks the harness-injected `ATTACHMENTS_PARTITION_PRIVATE_ATTACHMENTS_ROOT`. Re-run with it exported: **2/2 passed**. |
| TC-PHONE-HUB-006 (calls list cache) | cached page not invalidated, then ingested call not listed | Ingest runs through the command bus *inside the test process*, which in attached mode lacks the app's runtime env (it wrote `.mercato/cache/cache.db` while the app used `.ai/qa/ephemeral-cache.sqlite`). Exporting the cache path fixed the invalidation assertion. Diff check: query-engine changes are additive (`overlap`/`noverlap` branches only; `$or`/`$ilike` paths byte-identical), and `applyIndexDocEnrichers` returns early for entity types with no enrichers (only `catalog:catalog_product` registers one). See one-shot re-run below. |
| TC-WEBHOOK-009 (unsafe URL rejection) | private URL accepted (201) | Attached-mode env difference; passes one-shot (below). Webhooks untouched. |
| TC-START-001 ×2 (start page onboarding gate) | "Launch your own workspace" heading absent | **Environmental (CI-only env)**, see below. |
| TC-ONBOARDING-EMAIL-001 | `[internal] System email capture credentials are not configured by the integration harness` | **Environmental** (explicit harness precondition). |
| TC-DOCUMENTS-009 / -013 | collaboration response has no token; read-only banner absent | **Environmental (CI-only env)**, see below; documents package untouched. |

Flaky (passed on retry): TC-CRM-EMAIL-001, TC-CRM-EMAIL-VISIBILITY-004, TC-SALES-ADDR-CONTACT-002, TC-WF-037. All are outside this PR.

### One-shot re-runs (harness-owned env, `yarn test:integration:ephemeral <filter>`, same HEAD)

In attached mode the Playwright process does not inherit the app's runtime env, so the remaining failures were re-run with the harness starting the app and the tests together:

| Spec | One-shot result | Conclusion |
|---|---|---|
| TC-PHONE-HUB-006 | ✅ passed | Attached-mode artifact, not a regression. |
| TC-WEBHOOK-009 | ✅ passed | Attached-mode artifact. |
| TC-SX-001 | ✅ passed (attached, with `ATTACHMENTS_PARTITION_PRIVATE_ATTACHMENTS_ROOT` exported) | Attached-mode artifact. |
| TC-START-001 ×2 | ❌ still fails | Needs `SELF_SERVICE_ONBOARDING_ENABLED=true` + configured email delivery (`apps/mercato/src/app/start/page.tsx:88`). CI sets both at workflow level (`.github/workflows/ci.yml:27`, `:904`); this host does not. |
| TC-ONBOARDING-EMAIL-001 | ❌ still fails | Same: needs `SYSTEM_EMAIL_PROVIDER` capture (CI `ci.yml:904`). The spec states the precondition itself. |
| TC-DOCUMENTS-009 / -013 | ❌ still fail | Need the collaboration runtime (`OM_DOCUMENTS_COLLAB_INTEGRATION`, `DOCUMENTS_COLLAB_JWT_SECRET_V2`, `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL`), set only in CI (`ci.yml:73`, `:911-914`). |

**Verdict:** 0 regressions. Every failure either passes under the harness-owned env or depends on CI-only env for modules this PR does not touch (example start page, onboarding, documents).

## 3. Style-compliance pass (DS guardian over the PR's `.tsx`)

Clean apart from a hard-coded middot separator and a raw label/input pair in `OmnibusSettings` (now `FormField`) → **7.12-ds-fix** (2547c77055). The five polish items noted at checkpoints 13–14 → **7.12-ui-fix** (8dc28f8468):
- duplicate Cancel button per card;
- stale undo banner after Archive (`clearAllOperations()`);
- include-categories suggestion list stays open after a pick (`TagsInput` `closeSuggestionsOnSelect`);
- Channels table horizontal overflow (`overflow-x-auto`);
- price-kind suggestion list open on load in group terms (`disableInitialFocus`).

## 4. Residual findings carried to the review / summary

- Listing query budget is 13 uncached and 16 with a category filter, above spec §10's 13.
- Storefront rate limits stay inactive until `RATE_LIMIT_TRUST_PROXY_DEPTH` is set.
- The pgvector search path and the 429 path are unit-tested only.
- The draft-store seed upgrade action is unit-tested only (it needs `UPGRADE_ACTIONS_ENABLED` and version > 0.8.0).
- New `GET /api/ecommerce/domain-mappings` is gated by `ecommerce.stores.view`, a small read widening.
- `packages/ui` lookup sources hard-code `/api/catalog/*`.
- The seed persists the entity directly rather than through a command.
- US-E1 empty-intersection warning not built.
- Logo and favicon are URL fields only.
- Facets are counted in memory.

## 5. Review-loop re-gate (after `om-auto-review-pr` autofix, 7.13–7.18-review-fix)

**Fix commits:** a88d2e2ece, 116e43d19d, 2b5351a088, eb0537c398, c17c43d4aa, f25d337288.

| Check | HEAD | Result |
|---|---|---|
| full `validation.commands` (build → generate → build, i18n sync/usage, typecheck, test, build:app) | c17c43d4aa | ✅ except the identical `create-mercato-app` bwrap set (80/897, same failing test list as gate2). core 20069, ui 2511, shared 2643, search 376 passed |
| one-shot integration: ecommerce + catalog + customer_groups | c17c43d4aa | ⚠️ 218/219. TC-ECOM-013 also failed on the pre-fix code in one-shot mode, so it is pre-existing and not caused by the review fixes (see below) |
| `build:packages --force`, core unit suite, `typecheck --force`, `lint --force`, `build:app` | f25d337288 | ✅ core 20073 passed |
| one-shot integration: ecommerce + catalog + customer_groups | f25d337288 | ✅ **219/219** |

**TC-ECOM-013 root cause (7.18-review-fix):**
- Unauthenticated storefront requests and the CLI read the global cache namespace, because the API catch-all calls `runWithCacheTenant` only for authenticated requests. Admin writes invalidate the tenant namespace.
- So the Omnibus module config (and any implicitly cached value) stayed stale for the storefront for up to its TTL (60 s for module config).
- The one-shot harness shares one sqlite cache between the backfill CLI and the app. The CLI warmed a pre-enable copy, so the test saw Omnibus as disabled. Attached-mode runs hid the bug because they keep the CLI's cache separate.
- **Fix:** storefront handlers run post-resolution work, and buyer resolution, under `runWithCacheTenant(store.tenantId)`; the backfill CLI runs under its tenant.
- Verified by reproducing in attached mode with the shared cache exported (fails before, passes after) and by the 219/219 one-shot run.
