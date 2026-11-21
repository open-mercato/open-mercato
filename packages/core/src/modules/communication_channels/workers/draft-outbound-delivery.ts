import type { WorkerMeta } from '@open-mercato/queue'
import { COMMUNICATION_CHANNELS_QUEUES } from '../lib/queue'
import handleOutboundDelivery from './outbound-delivery'

export const metadata: WorkerMeta = {
  queue: COMMUNICATION_CHANNELS_QUEUES.draftOutbound,
  id: 'communication_channels:draft-outbound-delivery',
  concurrency: 1,
}

export default handleOutboundDelivery
