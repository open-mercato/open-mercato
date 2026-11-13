## 📸 UI QA evidence — PASS

**Verdict: ✅ PASS — fresh affected-scope complex QA resolves F1; unchanged coverage explicitly reconciled.**

QA head: 3041b04654766bb0e5696c4c13e82b781bdcdf2e

`om-auto-qa-pr --complex --orchestrated --skip-risk-checks`, inline under the held merge-buddy claim. Risk checks: skipped — operator run 02c8787f-62d5-4a0a-894d-cfa563ac6f2a. No protected or human-only gate is waived.

### Fresh runtime results

- 14 recorded browser checks PASS with14 fresh PNGs. Two **owned distinct tenant-bound users** in separate browser contexts edited different fields through the UI. B saved description; A made ten consecutive stale name writes: all409, visible failure/conflict, **no false All changes saved**, and every complete server record stayed equal to B's saved version.
- Keyboard focus/undo and another refusal worked; conflict Refresh then successful retry preserved B's description. No stale error/conflict remained after10seconds. Rapid name+description edits made exactly one coalesced PATCH. A second edit queued behind a deliberately delayed save completed sequentially without false idle or a spurious409.
- Controlled503 refused the write, left the full record unchanged and showed failure. Explicit next edit recovered both pending fields; successful screen remained clear after10seconds. Publish dialog/Escape worked; immediate reload cancelled the queued metadata timer.
- Narrow375px layouts in **en/pl/de/es/ko** keep translated actions within the viewport, with no horizontal overflow. EN/PL native tests independently exercise saving→409/error→reload→successful retry.
- **26/26 current-head native integration tests PASS**, zero skips/flaky: Forms UI wrapping, new metadata regression, locking, ACL, tenancy; warranty lifecycle/partial lines, isolation, return/credit bridges and undo/redo. Focused units12/12 and full configured validation are recorded in the [CR](https://github.com/open-mercato/open-mercato/pull/8983#issuecomment-6855733069).

### Scope reconciliation

The [previous complex report](https://github.com/open-mercato/open-mercato/pull/8983#issuecomment-6849573452) remains **45 PASS /1 FAIL on ab0e4936**; it has not been relabeled. The only later commit changes four Forms metadata files. All warranty source and original layout/locale controls remain byte-identical. Its45 unaffected browser observations (including warranty amounts, reversal, two-user conflicts, permissions, five-language editor layout, publish error/retry and loading recovery) remain attributed to that report, with46 published report/image files independently downloaded and SHA256 matched. The one failing F1 is replaced by the fresh affected-path tests above. Native coverage was actually rerun on this head; no old overall approval is carried forward.

### Environment, gaps and cleanup

Own exact-head production environment started through `om-prepare-test-env` using the authoritative `mercato test:ephemeral --no-reuse-env --force-rebuild`; cold and warm authenticated readiness passed on isolated port33267. Existing Playwright1.62.1 Chromium149 launched successfully; live aria snapshots preceded interaction. No worker, webhook, scheduler or external-provider behavior changes in this diff. Money/reversal browser checks are unchanged-source evidence from the prior report; current native lifecycle/undo assertions reran.

API usage is explicitly limited to self-contained setup, whole-record integrity readback, native permission/isolation/lifecycle probes and cleanup; primary save/conflict actions were UI-driven. No applicable new metadata scenario remains unexercised. Minor harness assumptions (networkidle with SSE, guessed error wording, expecting404 after archive) were corrected against observed UI/API contracts; the logs retain them.

Owned form archived with readback status archived, two users and role deleted and absence verified; browser contexts closed. All seven owned application/CLI processes stopped, exact own PostgreSQL container removed; no sibling environment reset. Source tree is unchanged after QA.

### Deferred follow-ups

None.
