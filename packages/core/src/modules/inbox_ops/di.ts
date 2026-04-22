import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  InboxSettings,
  InboxEmail,
  InboxSourceSubmission,
  InboxProposal,
  InboxProposalAction,
  InboxDiscrepancy,
} from './data/entities'

export function register(container: AppContainer) {
  container.register({
    InboxSettings: asValue(InboxSettings),
    InboxEmail: asValue(InboxEmail),
    InboxSourceSubmission: asValue(InboxSourceSubmission),
    InboxProposal: asValue(InboxProposal),
    InboxProposalAction: asValue(InboxProposalAction),
    InboxDiscrepancy: asValue(InboxDiscrepancy),
  })
}
