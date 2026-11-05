import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  InboxSettings,
  InboxEmail,
  InboxProposal,
  InboxProposalAction,
  InboxDiscrepancy,
} from './data/entities'

export function register(container: AppContainer) {
  container.register({
    InboxSettings: asValue(InboxSettings),
    InboxEmail: asValue(InboxEmail),
    InboxProposal: asValue(InboxProposal),
    InboxProposalAction: asValue(InboxProposalAction),
    InboxDiscrepancy: asValue(InboxDiscrepancy),
  })
}
