# HANDOFF — Browser-driven optimistic-locking coverage (PR vs #2055)

Resume with: `/auto-continue-pr-loop <this-PR#>` (or `/auto-continue-pr <this-PR#>`).
The PLAN task table is the source of truth — resume from the first non-`done` row.

## What & why
PR #2055 ships platform-wide OSS optimistic locking but only 13 executable specs (`TC-LOCK-OSS-001..013`,
API-level). The manual master plan (`.ai/qa/scenarios/TC-LOCK-OSS-000-manual-qa-master-plan.md`, 91 cases)
identified ~68 UI behaviors with no automated spec. This PR adds **browser-driven** specs
`TC-LOCK-OSS-014..046` so every case is covered and green. **Tests only — do not modify product code or PR #2055.**

## How to resume (exact steps)
1. `cd` into this worktree (`test/oss-optimistic-locking-browser-coverage`).
2. Ensure the ephemeral app is up: `yarn test:integration:ephemeral:start` then read `.ai/qa/ephemeral-env.json`
   for `base_url` (default `http://localhost:5001`). Docker is required and available.
3. Confirm the env is ON: pick any existing spec, e.g.
   `BASE_URL=$BASE_URL npx playwright test --config .ai/qa/tests/playwright.config.ts -g "TC-LOCK-OSS-007" --retries=0`.
4. Open `PLAN.md`, find the first non-`done` row, follow the **Per-step contract** there.
5. After each green spec: commit (one per file), flip the row to `done`, append a `NOTIFY.md` line.

## Key facts (so you don't re-discover them)
- **Conflict bar test id:** `page.getByTestId('record-conflict-banner')` (component
  `packages/ui/src/backend/conflicts/RecordConflictBanner.tsx`, `role="alert"`, title "Record changed").
- **Wire constants:** import `OPTIMISTIC_LOCK_HEADER_NAME`, `OPTIMISTIC_LOCK_CONFLICT_CODE`,
  `OPTIMISTIC_LOCK_CONFLICT_ERROR` from `@open-mercato/shared/lib/crud/optimistic-lock-headers`.
- **Login / token helpers:** `login(page,'admin')` from
  `@open-mercato/core/modules/core/__integration__/helpers/auth`; `getAuthToken(page.request,'admin')` from
  `.../helpers/api`. Fixtures: `.../helpers/{crmFixtures,catalogFixtures,salesFixtures,staffFixtures,plannerFixtures,currenciesFixtures,dictionariesFixtures,featureTogglesFixtures,businessRulesFixtures,inboxFixtures,...}`.
- **Deterministic browser conflict recipe:** create fixture → goto edit route → **out-of-band API PUT** with
  the entity's current `updated_at` header (advances it) → edit field + Save in browser → bar appears.
  Use the shared helper `optimisticLockUi.ts` (`bumpRecordViaApi`, `expectConflictBanner`, `expectNoConflictBanner`).
- **Admin creds:** `admin@acme.com` / `secret`. `admin` already has `sales.*` etc. via setup defaults
  (no `sync-role-acls` needed on a fresh ephemeral tenant).
- **Routes:** verified list in `.ai/qa/scenarios/TC-LOCK-OSS-000-manual-qa-master-plan.md` (companies-v2/[id],
  people-v2/[id], /backend/rules/[id], /backend/sets/[id], /backend/exchange-rates/[id], etc.).
- **Master-plan ↔ spec mapping:** PLAN.md "Manual cases" column.

## Guardrails
- If a case reveals a **real product bug** (not a test issue): STOP on that row, mark it `blocked`, write a
  per-test failure-analysis table (skill's mandatory format) into NOTIFY.md, and continue with other rows.
  Do NOT fix product code in this PR.
- Keep specs deterministic (out-of-band API bump, not two-tab sleeps). Clean up every fixture in `finally`.
- Re-run the full `-g TC-LOCK-OSS` suite every ~5 specs.

## Status snapshot (update on each resume)
- Draft PR **#2451** (base `feat/oss-optimistic-locking`). Ephemeral app at http://127.0.0.1:5001 (port 5001).
- **GREEN & pushed (8 spec files, 20 active tests):**
  - TC-LOCK-OSS-040 currencies (CUR-01) — 2
  - TC-LOCK-OSS-021 catalog categories (CAT-05/06) — 3
  - TC-LOCK-OSS-035 staff team-role/team (STF-01/02) — 4
  - TC-LOCK-OSS-037 resources + resource-types (RES-01/02/03) — 3
  - TC-LOCK-OSS-039 directory tenant/org (DIR-01/02) — 2
  - TC-LOCK-OSS-041 feature toggles + dictionaries (FT-01/DICT-01/02) — 4 (DICT via API fallback)
  - TC-LOCK-OSS-042 business_rules (BR-01/02) — clean-save green; **2 test.fixme (PRODUCT BUG, see below)**
- **PRODUCT FINDING (for #2055): business_rules `rules`+`sets` PUT routes ignore the lock header** → no 409, no bar.
  Fix on #2055: `packages/core/src/modules/business_rules/api/{rules,sets}/route.ts` PUT must return 409+conflict code.
  When fixed, drop the `.fixme` in TC-LOCK-OSS-042 and it goes green.
- **In flight (batch-2 workflow):** TC-LOCK-OSS-014 companies-v2, -015 people-v2, -019 product, -020 variant,
  -031 auth roles+ACL, -032 auth users+ACL, -043 webhooks/inbox/sync, -044 workflow/entities/checkout.
- **Still TODO (queue for next batches):** -016 deals, -017 deals kanban, -018 activity/task modals,
  -022 option-schema, -023 catalog false-positives + price kinds, -024..-030 sales (quote/adjustments/returns/
  payments/shipments/convert/channels/channel-offers/settings dialogs), -033 customer_accounts roles, -034 sidebar,
  -036 staff leave/job-history, -038 planner, -040 CUR-02 exchange-rates, -045 conflict-bar UX, -046 negatives.
- **How to resume:** re-read PLAN.md, ensure ephemeral up, run any green spec to confirm env, then pick the first
  non-done row and follow the Per-step contract. Reuse the green reference specs (esp. -040, -021, -039, -041) as templates.

### Snapshot v2 (after batch-2)
- **DONE & pushed (15 spec files + helper):** -014 -015 -019 -020 -021 -031 -032 -035 -037 -039 -040 -041 -042 -043 -044.
  ~38 active tests green; 5 `test.fixme` documenting **3 product findings** (business_rules rules/sets,
  workflows.definition, entities.records) — all on #2055, none fixed here.
- **IN FLIGHT (batch-3):** -016 deals, -028 sales channels (Alina blocker SAL-12), -033 customer_accounts roles,
  -036 staff leave/job-history, -038 planner, -045 conflict-bar UX, -046 negatives, -022 catalog option-schema.
- **REMAINING (batch-4 / resume — the bespoke-heavy ones):** -017 deals kanban (won/lost + drag),
  -018 activity/task modals (delete-after-delete), -023 catalog false-positives (variant price overrides) + price kinds,
  -024 sales quote header, -025 order adjustments/returns, -026 order payments/shipments, -027 quote→convert,
  -029 channel offers, -030 sales settings dialogs (payment/shipping/tax), -034 sidebar customization,
  -040 CUR-02 exchange-rates (optional — covered-by-equivalence), -045/-046 only if batch-3 leaves gaps.
- **Final gate before un-drafting:** run the whole suite `npx playwright test -g "TC-LOCK-OSS"` against the
  ephemeral env and confirm 0 failures (fixme=skipped is fine); then summarize the product findings on the PR.

### Snapshot v3 — COMPLETE (all 33 PLAN rows resolved)
- **34 spec files** (shared helper + TC-LOCK-OSS-014..046) committed & pushed, one atomic commit each.
- ~80 active tests green; ~12 `test.fixme`/`test.skip` documenting **8 product findings** on #2055 (see NOTIFY
  "CONSOLIDATED PRODUCT FINDINGS"). Two classes: (A) routes that don't enforce the lock at all
  (business_rules, workflows.definition, entities.records, sales **quotes**); (B) routes that DO enforce (409) but the
  page/dialog swallows it with an inline error/toast so the unified bar never surfaces (customer_accounts roles,
  ChannelOfferForm edit, sales settings dialogs, staff job-history).
- Coverage approach: browser conflict-bar assertion (`getByTestId('record-conflict-banner')`) where a real edit page
  exists; deterministic API-level 409 assertion (`putWithLock`+`expectConflictBody`) for pure command routes and a
  few impractical-to-drive UIs (documented per spec).
- **Nothing left to author.** Remaining optional follow-ups only: (a) re-enable the `test.fixme`/`test.skip` tests as
  #2055 fixes each product finding; (b) the opt-out negative (NEG-02) needs an app booted with `OM_OPTIMISTIC_LOCK=off`.
