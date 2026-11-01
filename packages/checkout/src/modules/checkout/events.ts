import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'checkout.template.created', label: 'Template Created', entity: 'template', category: 'crud' },
  { id: 'checkout.template.updated', label: 'Template Updated', entity: 'template', category: 'crud' },
  { id: 'checkout.template.deleted', label: 'Template Deleted', entity: 'template', category: 'crud' },
  { id: 'checkout.link.created', label: 'Link Created', entity: 'link', category: 'crud' },
  { id: 'checkout.link.updated', label: 'Link Updated', entity: 'link', category: 'crud' },
  { id: 'checkout.link.deleted', label: 'Link Deleted', entity: 'link', category: 'crud' },
  { id: 'checkout.link.published', label: 'Link Published', entity: 'link', category: 'lifecycle', clientBroadcast: true },
  { id: 'checkout.link.locked', label: 'Link Locked', entity: 'link', category: 'lifecycle', clientBroadcast: true },
  { id: 'checkout.transaction.created', label: 'Transaction Created', entity: 'transaction', category: 'crud' },
  { id: 'checkout.transaction.customerDataCaptured', label: 'Customer Data Captured', entity: 'transaction', category: 'lifecycle' },
  { id: 'checkout.transaction.sessionStarted', label: 'Payment Session Started', entity: 'transaction', category: 'lifecycle' },
  { id: 'checkout.transaction.completed', label: 'Transaction Completed', entity: 'transaction', category: 'lifecycle', clientBroadcast: true },
  { id: 'checkout.transaction.failed', label: 'Transaction Failed', entity: 'transaction', category: 'lifecycle', clientBroadcast: true },
  { id: 'checkout.transaction.cancelled', label: 'Transaction Cancelled', entity: 'transaction', category: 'lifecycle' },
  { id: 'checkout.transaction.expired', label: 'Transaction Expired', entity: 'transaction', category: 'lifecycle' },
  { id: 'checkout.link.usageLimitReached', label: 'Usage Limit Reached', entity: 'link', category: 'lifecycle', clientBroadcast: true },
  // Release 5, Step 2.12 (B.1, §10). State signals only — no checkout event sends a
  // notification to a buyer or approver (D-R5-32). The full §10 family (`.step_changed`,
  // `.submitted`, `.completed`, `.failed`, `.expired`, `.approval_*`, `checkout.payment.*`,
  // `checkout.compensation.*`) is declared incrementally as the Step that emits it lands
  // (Steps 2.13/3.5/4.1/4.2) — declaring an event with no emitter yet is the same dead-
  // surface this run's own precedent (Step 2.7) avoided for `customer_groups.approval.decided`.
  { id: 'checkout.session.created', label: 'Checkout Session Created', entity: 'session', category: 'lifecycle' },
  { id: 'checkout.session.canceled', label: 'Checkout Session Canceled', entity: 'session', category: 'lifecycle' },
  // Release 5, Step 4.1 (B.4 submit, §7.2 step 0 / §7.3). `.submitted` fires once per
  // `open -> submitting` CAS win; the `.completed`/`.failed`/`.payment.*`/`.approval_*`
  // family stays declared incrementally, per this file's own precedent, as the Step that
  // emits each one lands (Step 4.2 reaches a terminal state; this Step never does).
  { id: 'checkout.session.submitted', label: 'Checkout Session Submitted', entity: 'session', category: 'lifecycle' },
  { id: 'checkout.compensation.executed', label: 'Checkout Compensation Executed', entity: 'session', category: 'lifecycle' },
  { id: 'checkout.compensation.failed', label: 'Checkout Compensation Failed', entity: 'session', category: 'lifecycle' },
  // Release 5, Step 4.2 (B.4 submit, §7.2 steps 6-8 / §10). The family's terminal members —
  // `.completed`/`.failed` reach a terminal `CheckoutSession.status`; `checkout.payment.*`
  // is additive and session-scoped, firing ALONGSIDE Phase A's own `checkout.transaction.*`
  // events (§10's own text), never instead of them.
  { id: 'checkout.session.completed', label: 'Checkout Session Completed', entity: 'session', category: 'lifecycle' },
  { id: 'checkout.session.failed', label: 'Checkout Session Failed', entity: 'session', category: 'lifecycle' },
  { id: 'checkout.payment.initiated', label: 'Checkout Payment Initiated', entity: 'session', category: 'lifecycle' },
  { id: 'checkout.payment.succeeded', label: 'Checkout Payment Succeeded', entity: 'session', category: 'lifecycle' },
  { id: 'checkout.payment.failed', label: 'Checkout Payment Failed', entity: 'session', category: 'lifecycle' },
  // Release 5, Step 5.2 (C11, §8.2, D-R5-32). State signals only — `customer_groups` is the
  // only module that notifies about an approval decision (D-R5-6); checkout's own family
  // mirrors its resume subscriber's three reachable outcomes (`approved`/`rejected`, the
  // latter covering `rejected`/`expired`/`withdrawn` with the outcome in the payload).
  { id: 'checkout.session.approval_requested', label: 'Checkout Session Approval Requested', entity: 'session', category: 'lifecycle' },
  { id: 'checkout.session.approval_approved', label: 'Checkout Session Approval Approved', entity: 'session', category: 'lifecycle' },
  { id: 'checkout.session.approval_rejected', label: 'Checkout Session Approval Rejected', entity: 'session', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'checkout', events })
export const emitCheckoutEvent = eventsConfig.emit
export default eventsConfig
