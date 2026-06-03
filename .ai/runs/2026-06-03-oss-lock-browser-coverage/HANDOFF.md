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

## Status snapshot
- Branch created off `feat/oss-optimistic-locking` @ `004f68b90`. Run folder + PLAN/HANDOFF/NOTIFY committed.
- Next: task 0 (shared helper) → reference spec green → fan out per PLAN order.
- Update this snapshot block on each resume.
