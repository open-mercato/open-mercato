# PLAN — Fix all optimistic-lock issues on #2055 (Alina round-6 + my findings)

Branch: feat/oss-optimistic-locking (#2055). Goal: every issue fixed + integration test + verified green + CI green.
Source: PR #2055 comment 4615364957 (Alina) + my 8 findings. (#5 customer_accounts, #9 -012 already fixed by QA round-6.)

## Work items
| # | Issue | Type | Source | Spec/test | Status |
|---|---|---|---|---|---|
| 1 | business_rules rules + sets PUT — no lock enforcement | server | mine F1 | TC-LOCK-OSS-042 | todo |
| 2 | Workflow Visual Editor — stale save overwrites (no 409) | server | Alina + F2 | TC-LOCK-OSS-044 | todo |
| 3 | Webhooks stale DELETE still succeeds | server | Alina | TC-LOCK-OSS-043 | todo |
| 4 | sales quotes PUT — verify lock (code shows quote enforce now) | server | mine F4 | TC-LOCK-OSS-024 | todo |
| 5 | People v2 — stale overwrite still possible (real two-tab) | server/client | Alina A7 | TC-LOCK-OSS-015 | todo |
| 6 | Availability Schedule delete — false-success toast after 409 | client UX | Alina A1 | TC-LOCK-OSS-038 | todo |
| 7 | Webhooks delete — surface bar (not success) on 409 | client UX | Alina | TC-LOCK-OSS-043 | todo |
| 8 | data_sync /api/data_sync/options → 500 | bug | Alina A4 | new | todo |
| 9 | dictionaries save → 500 (DictionariesManager) | bug | Alina A5 | TC-LOCK-OSS-041 | todo |
| 10 | staff timesheets time-entries → 500 (background noise) | bug | Alina A9 | new | todo |
| 11 | Saved Views — raw `record_modified` text leaks in panel | client UX | Alina A6 | new | todo |
| 12 | ChannelOfferForm offer edit — drops 409 code → no bar | client | mine F6 | TC-LOCK-OSS-029 | todo |
| 13 | sales settings dialogs — inline error not unified bar | client | mine F7 | TC-LOCK-OSS-030 | todo |
| 14 | staff job-history — body updatedAt not header + 409 lacks code | server+client | mine F8 | TC-LOCK-OSS-036 | todo |
| 15 | Feature Toggle Type field not populated on edit (#2452) | bug | Alina A8 | new | todo |

## Method
- Verify each against the LIVE ephemeral app first (repro), fix on #2055, add/flip integration test, rebuild+verify, atomic commit.
- The app is a BUILT app → product fixes need rebuild+restart to verify (batch the rebuild, verify tests one-by-one).
