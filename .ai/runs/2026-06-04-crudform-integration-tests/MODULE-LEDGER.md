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
| A6 | auth | core | user (roles[] + CF + ACL), role (CF + ACL) | `feat/crudform-tests-auth` | — | ⬜ |
| A7 | sales | core | channel (CF), channel-offer | `feat/crudform-tests-sales` | — | ⬜ |
| A8 | workflows | core | definition (metadata.* dot-path — see #2503) | `feat/crudform-tests-workflows` | — | ⬜ |

## Tier B — hand-written / non-makeCrud saves

| Order | Module | Package | Surfaces | Branch | PR | Status |
|-------|--------|---------|----------|--------|----|--------|
| B1 | business_rules | core | rule, rule-set (+members[]) | `feat/crudform-tests-business-rules` | — | ⬜ |
| B2 | integrations | core | credentials (secret/text/select round-trip) | `feat/crudform-tests-integrations` | — | ⬜ |
| B3 | customer_accounts | core | customer-role (+portal perms), customer-user | `feat/crudform-tests-customer-accounts` | — | ⬜ |
| B4 | planner | core | availability-ruleset | `feat/crudform-tests-planner` | — | ⬜ |
| B5 | webhooks | webhooks | webhook (events multiselect + headers JSON) | `feat/crudform-tests-webhooks` | — | ⬜ |
| B6 | scheduler | scheduler | scheduled-job (scope/target/payload JSON) | `feat/crudform-tests-scheduler` | — | ⬜ |
| B7 | checkout | checkout | link-template, pay-link | `feat/crudform-tests-checkout` | — | ⬜ |

## Tier C — remaining makeCrud / scalar surfaces

| Order | Module | Package | Surfaces | Branch | PR | Status |
|-------|--------|---------|----------|--------|----|--------|
| C1 | directory | core | organization, tenant | — | — | ⏭️ covered by #2539 (TC-DIR-006..012) |
| C2 | feature_toggles | core | global toggle (superadmin) | `feat/crudform-tests-feature-toggles` | — | ⬜ |
| C3 | api_keys | core | api-key | `feat/crudform-tests-api-keys` | — | ⬜ |
| C4 | dictionaries | core | dictionary entry | `feat/crudform-tests-dictionaries` | — | ⬜ |
| C5 | communication_channels | core | channel | `feat/crudform-tests-comm-channels` | — | ⬜ |

## Notes

- `example` (todos) lives under `apps/mercato/src/modules/` (app, not a package) — no
  `__integration__` test files added there; its CF behavior is already exercised by
  `TC-CRM-028`.
- Enterprise sudo/security surfaces (#33/#34) are enterprise+sudo gated — defer / out of scope.
