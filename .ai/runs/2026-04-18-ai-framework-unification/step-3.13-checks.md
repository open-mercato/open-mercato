# Step 3.13 — verification log

**Timestamp:** 2026-04-18T16:05:00Z
**Step:** Phase 3 WS-C Step 3.13 — Integration tests for runtime policy, attachment bridge, and tool-pack coverage.
**Author:** auto-continue-pr executor subagent.

## Files created

- `.ai/qa/tests/ai-framework/TC-AI-001-auth-sanity.spec.ts` — Playwright: superadmin login reaches `/backend`, wrong password stays on `/login` with an error alert. Uses `DEFAULT_CREDENTIALS.superadmin` via the shared helper (never inlines the password).
- `.ai/qa/tests/ai-framework/TC-AI-002-agent-policy.spec.ts` — Playwright: `POST /api/ai_assistant/ai/chat?agent=…` HTTP e2e for unknown agent → 404 `agent_unknown`; malformed agent param → 400 `validation_error`; missing agent param → 400 `validation_error`; unauthenticated → 401 `unauthenticated`.
- `packages/ai-assistant/src/modules/ai_assistant/__tests__/integration/ws-c-policy-and-tools.test.ts` — Jest: policy gate + tool resolution pipeline (unknown/forbidden agent, super-admin bypass, allowedTools filtering, tool-level requiredFeatures skip-with-warn, readOnly mutation block, full `runAiAgentText` pipeline including SDK tool-map assertion).
- `packages/ai-assistant/src/modules/ai_assistant/__tests__/integration/ws-c-attachment-bridge.test.ts` — Jest: cross-tenant drop (no foreign tenant/org leakage in the warn), oversized image with no signer → `source: 'metadata-only'`, oversized image with signer → `source: 'signed-url'`, missing DI container graceful return.
- `packages/ai-assistant/src/modules/ai_assistant/__tests__/integration/ws-c-tool-pack-coverage.test.ts` — Jest: every search/attachments/meta tool declares `requiredFeatures`; tenant-context enforcement on `search.hybrid_search` and `attachments.list_record_attachments`; `meta.list_agents` empty-registry + RBAC + super-admin bypass; agent whitelisting all three packs yields the full SDK tool map with no extras.

## Scope notes

- Customer + catalog tool-pack scenarios from the brief (tenant isolation, not-found shape, `includeRelated` aggregates, `search_products` routing, `suggest_price_adjustment` `isMutation: false` + `currentPrice: null` fallback, `get_product_bundle` found/not-found) are already pinned by the per-pack unit tests under `packages/core/src/modules/{customers,catalog}/__tests__/ai-tools/**/*.test.ts` (333 suites / 3033 tests). Re-testing them from the ai-assistant harness would require cross-package Jest plumbing the current `moduleNameMapper` does not support (`@open-mercato/core/...` is not mapped). Deferred to the existing unit-test coverage; the integration suite instead asserts the cross-cutting invariants that unit tests cannot.
- The forbidden-agent (`agent_features_denied`) branch is exercised HTTP-free at the runtime-helper layer in the Jest integration file because no seeded non-superadmin role can be used to deterministically produce that deny code via HTTP without touching ACL fixtures that are out of scope for Step 3.13.

## Validation — targeted

- **Jest integration (new suites only):** `cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit --testPathPatterns="__tests__/integration"` → **3 suites / 22 tests, all green** (0.55s).
- **Jest regression (`packages/ai-assistant` full):** `cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit` → **28 suites / 338 tests, all green** (1.26s). Baseline before this Step was 25 / 316; delta +3 / +22 matches the new integration files exactly.
- **Jest regression (`packages/core` full):** `cd packages/core && npx jest --config=jest.config.cjs --forceExit` → **333 suites / 3033 tests, all green** (5.40s). Baseline 333 / 3033 preserved (Step 3.13 touched no core production files).
- **Typecheck:** `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app --force` → **2/2 successful** (23.24s). No new diagnostics; the only tolerated one remains the Step 3.1 `agent-registry.ts(43,7)` carryover.
- **`yarn generate`:** not run — Step 3.13 adds only test files, no module-root declarations or generator inputs.

## Playwright run

- `yarn test:integration --list` fails to enumerate tests because of a pre-existing environment conflict in `/Users/piotrkarwatka/Projects/mercato-development/.ai/tmp/review-pr/pr-1372/` (a leftover review worktree with its own `@playwright/test` copy that the root `playwright.config.ts` tries to load alongside the parent install). The error — `Requiring @playwright/test second time` — predates this Step (reproducible on `HEAD` before the Step 3.13 commits) and is not introduced by the new `.ai/qa/tests/ai-framework/*.spec.ts` files. The new Playwright specs typecheck cleanly in isolation (`npx tsc --noEmit --isolatedModules` against the two spec paths).
- Because the local dev runtime cannot be started in this session (already documented across prior Steps), the Playwright specs are landed as runnable tests that the next CI run, `yarn test:integration:ephemeral`, or a clean local environment (without the stale `.ai/tmp/review-pr/` artifacts) can execute against a real server. The auth-sanity and agent-policy scenarios are explicitly written to run with `DEFAULT_CREDENTIALS.superadmin` and the existing `getAuthToken` helper so no test-local credentials or fixtures are needed beyond what the dev database already seeds via `mercato init`.

## Browser evidence

- Step 3.13 delivers no UI surface — it adds Playwright HTTP-e2e specs (no browser interaction beyond `/login` smoke) and Jest integration suites. No new screenshots produced; the `step-3.13-artifacts/` folder was created to host any Playwright `--screenshot on` output produced during the first CI run that executes these specs. The checkpoint browser evidence covering the `/login` + `/backend` + catalog/people smoke is already captured at `.ai/runs/2026-04-18-ai-framework-unification/checkpoint-phase3-wsc-artifacts/checkpoint-phase3-wsc-browser-0{1,2,3}-*.png` and the Step 3.13 Playwright auth-sanity test (`TC-AI-001`) is the recorded-as-test version of that smoke.

## Blockers / decisions

- **Jest-level mock fallback** for `agent_features_denied`: explicit. Documented in the policy/tools integration file header.
- **Customer + catalog tool-pack coverage** deferred to the existing per-pack unit-test files: explicit. Documented in the tool-pack integration file header and above.
- **Playwright env conflict with `.ai/tmp/review-pr/pr-1372/`**: pre-existing. Non-blocking for Step 3.13; cleaning that leftover worktree is a separate operator task outside this PR's scope.
- **Attachment-signer HTTP test**: the `signed-url` promotion path is covered by the Jest integration file; the HTTP path cannot be exercised without a real signer wired into DI (Phase 3 has no concrete signer — see `attachment-parts.ts` docstring on `AttachmentSigner`).

## Hard-rule compliance

- BC: ADDITIVE only — all new files are tests; zero production changes.
- No secrets committed. Credentials come from `DEFAULT_CREDENTIALS.superadmin` via the shared helper.
- No raw `em.find(` / `em.findOne(` in any of the new files.
- No `*.md` documentation created outside the run folder.
