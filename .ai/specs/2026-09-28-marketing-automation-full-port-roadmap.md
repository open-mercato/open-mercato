# Marketing Automation — Full Port Roadmap (epic-level)

Companion to [`2026-09-28-marketing-automation-module.md`](2026-09-28-marketing-automation-module.md),
which specifies Phase 1 as built. This document plans the rest: functional parity with the
Magento module the work is ported from, **including** the expensive items.

Epic-level and deliberately not a feature spec: each phase below gets its own
`{date}-{title}.md` when it starts. Precedent for an epic-level entry: `SPEC-024`.

## Discovery: settled facts

The pre-work plan left six questions open. They are answered — in code, not documentation —
and three of its four risks are void as a result.

| Question | Answer | Consequence |
|---|---|---|
| Event bus between modules? | **Exists** — `packages/events`, `createModuleEvents`, `subscribers/*.ts` with `metadata = { event }` | Building one would have duplicated the platform. Risk void. |
| Transactional email? | **Exists** — `sendEmail` in `@open-mercato/shared`; `communication_channels` registers the transport; providers in `channel-resend`, `channel-ses`, `channel-gmail` | A separate `transactional-mail` module would have duplicated core. Risk void. |
| Orders / customers / cart in core? | Orders and customers **yes** (`sales`, `customers`). Cart **no** | Abandoned cart is blocked, not merely deferred. New finding the pre-work plan did not anticipate. |
| B2B accounts? | Companies exist in `customers`; quotes with `validUntil` in `sales`; a `sales.orders.approve` ACL feature already exists. **No** credit-limit concept | Order approval may be partly present — verify before building (Phase 7.1). |
| DI registration? | Awilix; `register(container)` per module | Confirmed. |
| Multi-tenancy automatic? | **No** — every query must carry `tenantId` and `organizationId` by hand | Risk **confirmed and live**. Enforced explicitly throughout Phase 1. |

Two corrections to the pre-work plan's design, already implemented:

- **Tags are not a new entity.** `customer_tags` + `customer_tag_assignments` exist with
  commands. A parallel tag table would fork segmentation away from the CRM.
- **Web push is the cheapest channel, not the most expensive.** `push_notifications` plus
  `channel-apns`/`channel-fcm`/`channel-expo` already exist; hand-rolling RFC 8291 is
  unnecessary.

## External dependencies — optional, taken last

Three items depend on third parties rather than on code. They are scheduled last and treated as
optional; what matters is knowing precisely what each one does and does not block.

| Item | Blocks | Does NOT block |
|---|---|---|
| Meta WhatsApp Business verification and template pre-approval (days to weeks) | 6.4 in full | anything else |
| An SMS account and sender number | 6.3 in full | anything else |
| A publicly reachable URL | Only verification from a real inbox: a mail client fetching the open pixel over the internet | **Building and testing Phase 3, 4.1, 4.2 and 4.3.** The tracking endpoints are ordinary routes; integration tests exercise them directly on localhost, and the funnel, A/B winner and send-time optimization read from the database, not from the network |

So the only real cost of deferring all three is that WhatsApp and SMS are absent, and that an
open/click demo has to be shown through the database and the runs view rather than through a real
mailbox. No earlier phase is gated.

## Phase 2 — structural decisions and shared foundations

Everything later rests on these, and each gets more expensive the more steps exist.

**2.1 Branching model — nested variants.** ✅ Implemented 2026-09-28. Landed as described, with
the lane choice derived from `hash(step id, subject id)` rather than stored, so a resume cannot land
a subject in the other lane. `flattenSteps` runs before `planSteps`, so the planner and the executor
stayed index-based and no column was added. Editor-side tree edits live in `lib/canvas/step-tree.ts`.
The top level stays a spine, so the canvas keeps its honesty (no user-drawn edges) and gains a split
node with N lanes that fan out and rejoin.
*We did not inherit the original's limitation that variant steps cannot carry their own delay —
steps live in jsonb with stable ids, so a lane can contain a wait. A lane that ENDS on a wait is
refused, for the same reason a trailing wait at the top level is: it parks its subjects forever.*

**2.2 Set-level audience evaluation.** A second evaluation path that returns matching subject
ids instead of a per-subject boolean, over `queryEngine`. This is the foundation segments need,
and it is why the original carries a combine-strategy seam that Phase 1 deliberately dropped.
Touches: `lib/engine/audience.ts` (add a set walk), new `lib/audience/set-resolver.ts`.
**Must land before Phase 5.**

**2.3 Event idempotency.** Dedupe a redelivered platform event: a deterministic queue job id
plus a unique key per (trigger, subject, campaign) so the same occurrence cannot start two runs.
Provider webhooks duplicate routinely, so this matters before any webhook-driven channel.

**2.4 Dry-run and test dispatch.** A CLI command and an API endpoint that answer "who would
receive this, and what would they get" without sending. The `marketing_automation.test_dispatch`
feature already exists with no implementation behind it. Cheap, and it is the safe way to
demonstrate a campaign.

**2.5 Runs UI.** `marketing_campaign_runs` and its `step_log` exist with no page. An operator
cannot currently see who is mid-journey, what each step did, or why a run died.

## Phase 3 — delivery tracking (prerequisite for three later features)

**3.1** `marketing_message_send_events` — delivered / opened / clicked / bounced, keyed to
`marketing_message_sends`.
**3.2** Tracking endpoints: a signed open pixel and a signed click redirect. No PII in the URL;
the token identifies the send, not the person.
**3.3** `send_email` rewrites links and embeds the pixel.

Unlocks 4.1, 4.2 and 4.3 — all three read from here, which is why tracking comes before them
rather than alongside. Verifiable without a public URL: integration tests call the endpoints
directly and assert the recorded events.

## Phase 4 — what tracking unlocks

**4.1** Per-campaign funnel (sent → delivered → opened → clicked → converted) plus a dashboard
widget via `widgets/dashboard/` and `analytics.ts`.
**4.2** A/B winner selection on click-through once each lane has enough sends. Needs 2.1 + 3.
**4.3** Send-time optimization: defer a send to each customer's historically best hour.
Email-only, because it is the only channel with open/click data. Needs 3.

## Phase 5 — segments and richer targeting

**5.1** `Segment` entity holding a condition expression, with membership resolved through 2.2.
**5.2** `in_segment` / `not_in_segment` audience support.
**5.3** RFM and CLV projections on the subject document, plus percentile comparisons.

## Phase 6 — channels

**6.1 Consent model — do this before any new channel.** The platform has none, so Phase 1 does
not gate sends on a marketing opt-in. **Compliance-blocking for production use.** Nearest prior
art: `consent_flag` in `SPEC-055` and the tenant legal-documents/consent-versioning spec.
**6.2 Push** — a `push` step over the existing `push_notifications` rails. Cheapest.
**6.3 SMS** — a new `packages/channel-<provider>` implementing `ChannelAdapter` with
`channelType: 'sms'`, a `sms` notification delivery strategy for per-user opt-out, a delivery
status webhook, and an opt-out table. Blocked on the account (see Start now).
**6.4 WhatsApp** — provider package, admin-managed template approval lifecycle, status webhook.
Blocked on Meta verification (see Start now).

Every channel step routes through the `communication_channels` outbound queue so retries,
dead-lettering and per-tenant credentials apply, rather than calling a provider directly.

## Phase 7 — B2B

**7.1 Verify first.** `sales.orders.approve` already exists as an ACL feature. Establish what
`sales` already does for approvals before building a parallel flow.
**7.2** Credit limit: entity per company, an endpoint for "my limit", threshold alerts, and an
optional hard checkout block at full utilization.
**7.3** Order approval: token-based approve/reject from an email without logging in, plus
escalation when an approval goes unanswered.
**7.4** Reorder reminders from each customer's own purchase interval — cheap, reuses the subject
document and the existing sweep.

## Phase 8 — breadth and authoring comfort

Remaining triggers already stubbed in the catalog (quote, invoice, payment, deal won/lost, tag
removed) — mostly copy-paste subscribers. Steps: `notify`, `send_webhook` (over
`@open-mercato/webhooks`), dynamic content, coupon generation (**verify a coupon primitive
exists before promising it**). Campaign calendar, template library, import/export (nearly free —
the graph already *is* the contract), and a form-based authoring fallback beside the canvas.

## Blocked on other work

Abandoned cart, browse abandonment and on-site behaviour tracking all need cart sessions and a
storefront: `SPEC-029`. The trigger is listed in the catalog as unavailable with a reason so the
palette explains itself, and its context contract is written down.

## Definition of done, per phase

Each phase ships: its own spec, integration tests for every affected API path and key UI path,
i18n in all five locales, and a green run of the ordered `validation.commands` gate from
`.ai/agentic.config.json`. A phase that sends messages also ships a dry-run path before it
ships the send.
