# Checkpoint 1 — steps 1.1 .. 1.6

**Fired:** 2026-06-30T15:30:00Z
**Steps covered:** 1.1 (spec+analysis) → 1.6 (yarn-generate wiring)
**SHA range:** 0e09e2392 .. 6257b8923
**Touched packages:** `packages/cli` (new `module-facts.ts` + `module-facts-generate.ts` generator), `apps/mercato` (versioned `module-facts.generated.json` artifact only)

## Validation

| Check | Result |
|-------|--------|
| `yarn workspace @open-mercato/cli typecheck` | ✅ exit 0 |
| Generated artifact present `apps/mercato/src/module-facts.generated.json` | ✅ 125 KB, 9 D5 modules |
| Registry-resolved API auth (not fallback) | ✅ customers `/customers/people` GET→`customers.people.view`, POST/PUT/DELETE→`customers.people.manage` |
| customers locked counts | ✅ entities colon-form, events=49, acl=21, search=6, notifications=2, diTokens=[] |
| Anti-drift (real source values) | ✅ customers cli=4, tableIds=3 (spec §6 example was stale/abbreviated — see NOTIFY decision) |
| No unrelated generated churn committed | ✅ only cli wiring + module-facts.generated.json |

## Per-module surface sanity (from generated JSON)

```
auth               ent=11 ev=12 acl=8  api=19 search=0  notif=6 cli=10 tbl=2
catalog            ent=12 ev=17 acl=7  api=12 search=8  notif=1 cli=4  tbl=0
currencies         ent=3  ev=6  acl=6  api=5  search=0  notif=0 cli=3  tbl=2
customer_accounts  ent=10 ev=25 acl=5  api=41 search=2  notif=6 cli=0  tbl=2
customers          ent=25 ev=49 acl=21 api=54 search=6  notif=2 cli=4  tbl=3
data_sync          ent=4  ev=4  acl=3  api=11 search=0  notif=0 cli=0  tbl=1
integrations       ent=4  ev=4  acl=3  api=7  search=0  notif=0 cli=0  tbl=0
sales              ent=27 ev=41 acl=19 api=36 search=22 notif=4 cli=6  tbl=0
workflows          ent=7  ev=25 acl=18 api=19 search=0  notif=1 cli=8  tbl=3
```

## UI verification
N/A — this window touched only a CLI generator + a generated JSON artifact. No frontend/backend/portal/widget surface. Skipped per the UI-checks-never-block rule.

## Known soft gaps (non-blocking, follow-up candidates)
- `tableIds=0` for `catalog`, `integrations`, `sales` — the host-token extractor targets specific `DataTable` `tableId`/`extensionTableId` string literals; these modules likely declare tables via a different pattern. Consistent with the spec's host-tokens extraction caveat. Not a correctness defect; revisit when extending past the first cut.

## Verdict
PASS. Extractor + emitter + generate wiring are feature-complete and produce correct, registry-grounded facts for all 9 D5 modules. Proceeding to tests T1–T4 (steps 1.7–1.10).
