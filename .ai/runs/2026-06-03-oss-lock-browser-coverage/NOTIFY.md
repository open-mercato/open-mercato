# Notification log — 2026-06-03-oss-lock-browser-coverage

Append-only. Newest at the bottom.

## 2026-06-03 — run scaffolded
- Branch `test/oss-optimistic-locking-browser-coverage` off `feat/oss-optimistic-locking` @ `004f68b90`.
- Goal: browser-driven specs `TC-LOCK-OSS-014..046` covering the ~68 manual-only cases from the master plan.
- PLAN.md / HANDOFF.md / NOTIFY.md committed. Next: shared UI helper + reference spec.

## 2026-06-03 — pattern proven + draft PR + batch-1 dispatched
- Shared helper `optimisticLockUi.ts` green (585e03d). Reference spec `TC-LOCK-OSS-040` currencies CUR-01 green (382e195).
- Draft PR opened: #2451 (base feat/oss-optimistic-locking). Run folder is the resumable handoff.
- Batch-1 workflow dispatched (6 subagents, parallel) authoring + greening grouped CrudForm specs:
  TC-LOCK-OSS-021 (catalog categories), -035 (staff), -037 (resources), -039 (directory),
  -041 (feature toggles + dictionaries), -042 (business rules). Agents write+green only; parent commits each atomically.

## 2026-06-03 — batch-1 landed (5 green specs) + 1 PRODUCT BUG found
- GREEN & committed/pushed: TC-LOCK-OSS-021 (catalog categories, 3), -035 (staff team-role/team, 4),
  -037 (resources, 3), -039 (directory tenant/org, 2), -041 (feature toggles + dictionaries, 4). 16 tests, all pass.
- **PRODUCT BUG (PR #2055): business_rules `rules` + `sets` PUT routes do NOT enforce optimistic locking.**
  Hand-rolled routes (not makeCrudRoute) never read the lock header / compare updated_at → stale edit returns 200,
  conflict bar never appears, though the edit pages DO send buildOptimisticLockHeader. Confirmed via spec failure
  (2/3) + direct probe. Fix on #2055: api/business_rules/{rules,sets}/route.ts PUT must return 409 + conflict code.
  TC-LOCK-OSS-042: 2 stale-edit tests `test.fixme` (flip green once routes fixed) + clean-save test green.
- Directory note: superadmin ORG edit GET omits updatedAt (aggregate branch) → no bar for superadmin; admin path
  (single-tenant branch) is correct and is what -039 exercises. Minor; not blocking.

## 2026-06-03 — batch-2 landed (7 green specs) + 2 more PRODUCT BUGS
- GREEN & pushed: TC-LOCK-OSS-014 companies-v2 (3), -015 people-v2 (2, clean-save guard dropped as flaky/covered-elsewhere),
  -019 product (2), -020 variant (2; delete via API fallback — variant form renders no delete button by design),
  -031 auth roles+ACL (3), -032 auth users+ACL (2), -043 webhooks+inbox+sync (4, API-level).
- **PRODUCT BUG (#2055) — workflows.definition PUT ignores the lock at runtime** even though it registers a reader +
  calls validateCrudMutationGuard and has a passing UNIT test. Likely root cause: the request-scoped
  crudMutationGuardService snapshots getAllOptimisticLockReaders() at container-build time, but the route-registered
  reader ('workflows.definition') is an import side-effect of the route module → absent from the snapshot → guard
  short-circuits. Stale PUT returns 200 (verified live). This timing bug could affect OTHER route-registered readers.
  TC-LOCK-OSS-044: WF clean-save green; 2 stale WF tests test.fixme.
- **PRODUCT GAP (#2055) — custom-entity record PUT (entities.records) registers no reader / no guard** → stale write
  returns 200, no bar, though the edit page sends the header. TC-LOCK-OSS-044 ENT-01 test.fixme.
- CHK-01/02 (checkout) N/A on OSS — no enforceCommandOptimisticLock checkout route exists.
- TOTAL so far: 15 spec files + helper; ~38 active tests green; 5 test.fixme documenting 3 product findings
  (business_rules rules/sets, workflows.definition, entities.records).
