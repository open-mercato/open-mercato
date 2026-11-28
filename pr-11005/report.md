## 📸 UI QA evidence — FAIL

**Verdict: ❌ FAIL** — core address-policy checks pass, but the settled locked-address screen overflows a390px viewport to416px. The affected UI file is unchanged by this PR; this is a separate observed mobile issue, not attribution to the command fix. No QA approval or failure label is applied.

**Verified:** PR#11005 at `8cf69e50000b5d75b772c1bd9d65386f59ad6db4`; production `http://127.0.0.1:39643`, Chromium/Playwright1.61.1, admin and two own tenant-bound actors.

QA head: 8cf69e50000b5d75b772c1bd9d65386f59ad6db4

| # | Route/action | Expected | Observed | Result / evidence |
|---|---|---|---|---|
| 1 | Sales configuration UI: customer editable, addresses locked | Save null customer policy and [] address policy | Settings PUT200 returned exact policy | PASS; step-02-address-policy-restricted.png |
| 2 | Order Addresses tab at desktop | Show restriction and disable address submit | Restriction visible; Update addresses disabled | PASS; step-04-locked-addresses.png |
| 3 | UI: cancel real customer change | No persistence | Complete GET record unchanged after cancel | PASS |
| 4 | UI: confirm and retry restricted customer change | 400 refusal, clear feedback, preserve all fields | Both attempts400; complete GET record unchanged; clear inline error and toast | PASS; step-06-customer-change-refused.png |
| 5 | UI: Escape then same-customer recovery | Same-customer save succeeds and preserves snapshots | Escape reopened selection;200; snapshots retained after10seconds | PASS; step-07-same-customer-recovery.png |
| 6 | API: change, detach and repeat with locked addresses | All400; order entirely unchanged | All400; full GET response equals baseline; comment did not persist | PASS |
| 7 | API: uppercase same-customer save | 200 and both saved snapshots unchanged | 200; canonical customer UUID and both snapshots retained | PASS |
| 8 | API: address-free order and quote changes | Changes remain allowed | Both200; new customer persisted; quote snapshots cleared | PASS |
| 9 | API: narrow tenant-bound role direct write | 403 | Own role/user created; direct order mutation403 | PASS |
| 10 | API: second actor saves, first actor sends stale version | 200 then409 without lost update | Own distinct second user200; stale first actor409; second comment retained, stale customer reference not persisted | PASS |
| 11 | UI: allow addresses then confirm actual customer change | 200; old snapshots cleared; no unrelated field changes | 200; new customer and null snapshots persisted. Whole-record comparison changed only customer, customer snapshot, address snapshots and updatedAt | PASS; step-10-allowed-customer-change.png |
| 12 | English and Polish order detail at390px | Localized core labels and readable order detail | Polish order/customer/action labels rendered; English detail exercised | PASS; step-09-polish-mobile-order.png |
| 13 | Settled English locked-address screen at390px | Document fits viewport; address fields remain within390px | Document/body416px; alert400px extends to416px and address form exceeds viewport. Allowed-state control has document390px and no overflowing elements | FAIL; step-12-mobile-addresses-restricted-settled.png |
| 14 | Complex keyboard/double-submit/long-content/full state matrix | Exercise remaining boundaries | Ctrl+Enter retry did not yield expected dialog in driver; not diagnosed. Double-click submit, long-content stress, Polish refusal, no-permission UI, forced error/loading and undo/audit remain unverified | not exercised |

### Findings

**P2 — locked-address mobile overflow.** At390px, `documentElement.scrollWidth` and body width are416px. The alert is400px wide and extends to416px; address fields extend past the viewport. The allowed-address control stays390px with no overflow. Reproduced after a3second settle; see `mobile-geometry.json` and `mobile-geometry-allowed.json`. Rendering location: `packages/core/src/modules/sales/components/documents/AddressesSection.tsx:1105` (unchanged in this PR).

### Tests and environment

- Focused regression:33/33 passed. All Sales command tests:64 suites,714/714 passed.
- Companion preparation delegated to repository CLI with isolated Postgres35102/app39643; initialization58s, production app build239s, readiness14s. Warm preparation reused the same exact-head instance.
- Chromium doctor and real UI login/settings/order flows succeeded. First network-idle navigation and early-hydration attempts were corrected; a raw API request without a bearer returned401 and was corrected.
- All8 own fixtures were deleted with HTTP200; app, Postgres and owned Ryuk stopped/removed. Original branch restored; no tracked diff, commits, source pushes, merges or pipeline changes. Runtime email-capture log restored after stopping. Completion/lock proof is in `completion.json`.

### ⚠️ Not exercised

- API-only checks: detach/casing, empty order, quote, permissions and stale second actor. These do not establish the corresponding full browser flows.
- Not exercised: stored address IDs individually at runtime (unit coverage exists), contact replacement, cross-tenant second organization, unrelated worker/subscriber side effects, notification delivery, undo/audit, all whole-record lifecycle reversals.
- Amounts/decimal-comma input and money reversal checks inapplicable: no amount mutation in this command change/scenario. Zero-priced placeholder fixtures; no financial behavior inferred.
- No new user-facing copy or shared UI helper changed. .uxproof not present; contract conformance check inapplicable.
- Initial driver failures were corrected for navigation/hydration and explicit API bearer authentication; those failures are not claimed as product defects. Keyboard retry remains unresolved.

The unresolved keyboard retry and remaining boundaries prevent a complete complex-depth PASS independently of the demonstrated mobile failure. The existing unrelated Forms CI review blocker remains unchanged.

### Follow-up integration scenario

No browser-level test ships in this PR. Add fixtures for two customers and an order with both stored snapshots; configure customer edits allowed/address edits blocked through the product; cancel then confirm a customer change, verify400 and whole-record equality, retry, and re-save the original customer. Check an address-free order and quote still switch; allow addresses, switch, and verify snapshots clear with unrelated fields preserved. Add distinct-user stale-write and narrow-role403 assertions and a390px locked-address geometry assertion. Remove all fixtures in finally.

### 📸 Screenshots

Twelve genuine local browser PNGs accompany this bundle; key checkpoints are policy restriction, locked addresses, customer refusal, successful recovery, allowed change, and the settled mobile failure. Screenshot URLs are attached by the tracker evidence publisher.
