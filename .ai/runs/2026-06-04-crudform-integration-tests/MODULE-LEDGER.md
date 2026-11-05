# MODULE LEDGER — CrudForm field-persistence sweep (cross-PR program)

Resumable matrix for the module-by-module rollout (#2466 automated follow-up). Each module
ships as its **own stacked PR** branched off `feat/crudform-integration-tests`, targeting
`develop`. Update this file as PRs open/merge so any session can resume.

Status: ⬜ todo · 🔵 PR open · ✅ merged · ⏭️ skip (covered elsewhere / out of scope)

Spec id convention: `TC-<MOD>-CRUDFORM-NNN`. Each spec: create → read-back → assert ALL
fields (scalars + dict + **custom fields** + multiselect) → update → read-back → assert →
delete in `finally`. All gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED`.

## Tier A — rich fields (custom fields / dictionary / multiselect) — do first

| Order | Module | Package | Surfaces (entity) | Branch | PR | Status |
|-------|--------|---------|-------------------|--------|----|--------|
| A1 | resources | core | resource (CF text/number/select/boolean), resource-type · capacityUnit dict deferred (example-seeded) | feat/crudform-tests-resources | #2551 | 🔵 PR open (stacked on #2548) |
| A2 | staff | core | team-member (role_ids/tags multiselect + 6-kind CF), team, team-role, timesheet-project | feat/crudform-tests-staff | #2553 | 🔵 PR open (stacked on #2548) |
| A3 | catalog | core | product (multichoice CF), variant (prices), category | feat/2555-crudform-tests-catalog | — | 🔵 specs ready (TC-CAT-CRUDFORM-001..003, #2555); off develop (#2548 merged); PR pending |
| A4 | customers | core | person/company/deal (inline + CF + dictionary) | `feat/crudform-tests-customers` | — | ⬜ |
| A5 | currencies | core | currency (scalars), exchange-rate | feat/crudform-integration-tests | #2548 | 🔵 currency covered in foundation PR #2548 |
| A6 | auth | core | user (roles[] + CF + ACL), role (CF + ACL) | `feat/crudform-tests-auth` | — | 🔵 specs ready — TC-AUTH-CRUDFORM-001 (user), -002 (role); CF defs created at runtime (auth has no ce.ts); ACL complements TC-AUTH-043/049; PR pending |
| A7 | sales | core | channel (CF + multi-select), channel-offer | feat/crudform-tests-sales | #2558 | 🔵 specs written; PR pending |
| A8 | workflows | core | definition (metadata.* dot-path — see #2503) | feat/crudform-tests-workflows | — | 🔵 PR open (#2559; TC-WF-CRUDFORM-001, complements TC-WF-014) |

## Tier B — hand-written / non-makeCrud saves

| Order | Module | Package | Surfaces | Branch | PR | Status |
|-------|--------|---------|----------|--------|----|--------|
| B1 | business_rules | core | rule (scalars + jsonb condition/actions), rule-set (+members[]) | feat/2560-crudform-tests-business-rules | #2632 | 🔵 spec ready — PR #2632 open for #2560 (stacked on #2548) |
| B2 | integrations | core | credentials (secret/text/select round-trip) | feat/crudform-tests-integrations | — | ⬜ spec implemented (#2561, TC-INTEG-CRUDFORM-001); open PR → 🔵 |
| B3 | customer_accounts | core | customer-role (+portal perms), customer-user · TC-CACC-CRUDFORM-001/002 | feat/crudform-tests-customer-accounts | — | 🔵 PR open (#2562) |
| B4 | planner | core | availability-ruleset (scalars: name/description/timezone — no CF/dict/multiselect declared) | `feat/crudform-tests-planner` | — | 🔵 spec written (TC-PLAN-CRUDFORM-001); PR pending |
| B5 | webhooks | webhooks | webhook (events multiselect + headers JSON) · no custom fields | feat/crudform-tests-webhooks | — | 🔵 PR open (stacked on #2548) — TC-WH-CRUDFORM-001 |
| B6 | scheduler | scheduler | scheduled-job (scope/target/payload JSON) — TC-SCHED-CRUDFORM-001 | feat/crudform-tests-scheduler | — | 🔵 PR open (targets develop; #2548/#2551/#2553 merged) |
| B7 | checkout | checkout | link-template (TC-CHK-CRUDFORM-001), pay-link (TC-CHK-CRUDFORM-002) | `feat/crudform-tests-checkout` | #2566 | 🔵 PR open (stacked on #2548) |

## Tier C — remaining makeCrud / scalar surfaces

| Order | Module | Package | Surfaces | Branch | PR | Status |
|-------|--------|---------|----------|--------|----|--------|
| C1 | directory | core | organization, tenant | — | — | ⏭️ covered by #2539 (TC-DIR-006..012) |
| C2 | feature_toggles | core | global toggle (superadmin) · scalars + typed defaultValue (boolean/string/number/json) | `feat/crudform-tests-feature-toggles` | — | 🔵 PR pending (#2567 · TC-FT-CRUDFORM-001) |
| C3 | api_keys | core | api-key · create-once (no update surface) | `feat/2568-crudform-tests-api-keys` | — | 🔵 |
| C4 | dictionaries | core | dictionary entry (scalars: value/label/color/icon/position/isDefault) | feat/2569-dictionaries-crudform | #2569 | 🔵 spec staged (inline round-trip — entry routes are PATCH + path-param, runCrudFormRoundTrip N/A) |
| C5 | communication_channels | core | channel | `feat/crudform-tests-comm-channels` | — | ⬜ |

## Notes

- **Tier B harness seam (added by B5/webhooks):** hand-written modules whose CrudForm submits to
  detail routes (`POST /collection`, `PUT /collection/:id`, `DELETE /collection/:id`) can't use the
  harness's default makeCrud collection verbs. Pass `recordPath` (a callback returning the per-record
  `/collection/:id` URL) to `runCrudFormRoundTrip` — it routes the update PUT and the cleanup DELETE to that per-record URL
  (no `?id=`), while read-back still uses a custom `readById` (detail GET). Reuse this for B6/scheduler
  and B7/checkout if they also use path-param detail routes. Responses there are camelCase, so scalar
  expectations use camelCase keys (no snake_case conversion).
- `example` (todos) lives under `apps/mercato/src/modules/` (app, not a package) — no
  `__integration__` test files added there; its CF behavior is already exercised by
  `TC-CRM-028`.
- Enterprise sudo/security surfaces (#33/#34) are enterprise+sudo gated — defer / out of scope.
- **api_keys (C3, #2568)** is **create-once + delete** — the route exports GET/POST/DELETE only
  (no PUT; `updateApiKeySchema` is declared but unwired) and there is no edit page, so
  `TC-APIKEY-CRUDFORM-001` covers create → read-back → assert (scalars + `roles[]` array) →
  delete and intentionally has **no update step**. Read-back uses `?search=` (the list has no
  `?id=`/`?ids=` filter) and responses are camelCase. No custom fields (no `ce.ts`).
