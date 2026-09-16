# Checkout funnel interactive prototype

This directory contains a static, pre-implementation prototype derived from
`.ai/specs/2026-03-19-checkout-simple-checkout.md` and its §20 story map.

**Two surfaces, drawn differently on purpose.** Screens 1–18 are the buyer's funnel and use **storefront
chrome** — a deliberate, explicitly requested exception to `om-mockup-prototype`'s backend scope, on the same
terms the previous revision recorded. Screens 19–21 are genuine backend surfaces and use the real AppShell.

**Coverage.** Every funnel step, including the stale-rate invalidation (R5) and the B2B payment step that
captures a PO number. Both submit outcomes: an order after payment, and a quote that completes immediately
with no payment step reached. Every refusal that has a state of its own — price changed (R4), stock shortfall,
credit refused, the assortment-visibility lock refusal, the approval threshold, the `423` a second tab sees
(R6), and a double submit refused as `409 submit_in_progress` (R2). The B2B approval gate with its cart left
**unlocked** while parked, and its re-approval edge case when the total rose after approval (R8). On the admin
side: the session list, the session detail with its redacted event trail, and a compensation that failed and
was escalated rather than swallowed (R9).

**The workflow correlation.** Screen 20's session detail carries `workflow_instance_id` as a link to the
engine's own run, with the instance's paused state and the stalled-instance threshold that puts this session
on the operator report. The trail and the engine's log are separate records; without this id nobody can read
them side by side.

**Not drawn, deliberately.** The four `workflows` processes of §5.1 — post-submit orchestration, the B2B
approval sub-flow, abandoned-checkout recovery and failed-compensation escalation — all run past the point
where the buyer is waiting, and none has a UI of its own. They are named on screens 20 and 21. The four risks
with no state of their own (R1, R3, R7, R10) are named in the spec's §20 rather than left to look missing:
they are mitigated by a conditional status update, idempotency keys, a serializable transaction and rate
limiting — mechanisms, not screens.

**Reused from the previous revision.** Nineteen screens are carried over verbatim; the assortment lock refusal
moves from the end of the file into the blocked-submit cluster where it belongs, and screens 18 and 21 are new.
Four defects inherited with them are fixed: `.co-narrow` and `.sf-price-was` were used but never defined, so the
funnel container was full-width and the previous price was not struck through; `.row-3` never sized a bare icon;
and every screen heading kept its old number after the reorder.

## Review

Open `index.html` directly, or serve this directory on localhost when browser automation requires HTTP:

```bash
python3 -m http.server 8899 --bind 127.0.0.1
```

Keep the server attached to the current terminal session and stop it immediately after review.

The toolbar supports click-through, presentation, and comment modes. Comments are not live collaboration: they remain in this browser until a reviewer chooses **Export for repository**, replaces `comments.js`, and commits the result. The operation-log format preserves independent replies and deletion tombstones when reviewers merge exports.

## Limitations

- The HTML illustrates flow and layout; it is not production implementation.
- Icons use an embedded SVG sprite instead of `lucide-react`.
- Text is hardcoded instead of translated through `useT()`.
- Sample records must remain synthetic and fictional.
- `tokens.css` is generated. Refresh it with the skill's `sync-tokens.mjs` script rather than editing it.
