import { createModuleEvents } from '@open-mercato/shared/modules/events'

// Step 4.4 (§6.8). The thread-open family (`.thread.opened`, `.participant.joined`,
// `.message.posted`) and the proposal-authoring-side family (`.proposal.published`,
// `.withdrawn`, `.superseded`). §6.8 also names `.thread.closed`, `.participant.left` and
// `.attribution.degraded` — written by mechanisms a LATER Step owns (the §5.10 retention/
// erasure sweepers, the §6.7 attribution subscriber), so they stay deliberately NOT declared,
// mirroring Step 4.3's own "defer a feature/event id until the thing that emits it exists"
// precedent. See NOTIFY.md's Step 4.4 entry.
//
// Step 4.4-fix (§6.6) adds `.proposal.accepted`/`.rejected`/`.expired` — the terminal-state
// subscriber's own emissions (`lib/terminalStateSubscriber.ts`), the three ids Step 4.4
// itself deferred for exactly this reason.
//
// Step 5.3 adds `.participant.left` — the console's own `POST /threads/:id/join`'s
// counterpart (`/leave`), the one remaining id §6.8's own table names that Step 4.4 had not
// yet built a writer for. `.thread.closed` stayed deferred at that point — the §5.10
// idle-close sweeper had not shipped yet (PLAN.md's Step 4.5 decision).
//
// Step 5.4 adds `.attribution.degraded` (§6.7/§6.8) — the `cart.cart.converted` subscriber's
// own operator-facing safety-net signal, emitted when a proposal-touched conversion arrives
// with no (or an incomplete) `lineMap`. Deliberately NOT `clientBroadcast: true` — §6.7's own
// text: "not broadcast to either [bridge]: it is an operator signal, the same reasoning
// `cart.line.visibility_rejected` already applies."
//
// Step 6.1 adds `.thread.closed` (§5.10, §6.8, S7) — the idle-close sweeper's own emission
// (`lib/sweepers.ts#sweepIdleThreads`), the one remaining thread-lifecycle id Step 4.4 itself
// deferred. `clientBroadcast: true`, same as every other thread/participant/message/proposal
// event, so the rep console's own open thread (if any) reflects the close without polling.
//
// `clientBroadcast: true` on every one of the thread/participant/message/proposal events
// (§6.8: "on thread, participant, message and proposal events so the rep console updates
// without polling").
const events = [
  { id: 'assisted_selling.thread.opened', label: 'Assisted Selling Thread Opened', entity: 'thread', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.thread.closed', label: 'Assisted Selling Thread Closed', entity: 'thread', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.participant.joined', label: 'Assisted Selling Participant Joined', entity: 'participant', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.participant.left', label: 'Assisted Selling Participant Left', entity: 'participant', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.message.posted', label: 'Assisted Selling Message Posted', entity: 'message', category: 'crud', clientBroadcast: true },
  { id: 'assisted_selling.proposal.published', label: 'Assisted Selling Proposal Published', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.proposal.withdrawn', label: 'Assisted Selling Proposal Withdrawn', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.proposal.superseded', label: 'Assisted Selling Proposal Superseded', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.proposal.accepted', label: 'Assisted Selling Proposal Accepted', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.proposal.rejected', label: 'Assisted Selling Proposal Rejected', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.proposal.expired', label: 'Assisted Selling Proposal Expired', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.attribution.degraded', label: 'Assisted Selling Attribution Degraded', entity: 'attribution', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'assisted_selling',
  events,
})

export const emitAssistedSellingEvent = eventsConfig.emit

export type AssistedSellingEventId = typeof events[number]['id']

export default eventsConfig
