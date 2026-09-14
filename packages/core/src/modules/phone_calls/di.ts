import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { PhoneCall, PhoneCallParticipant } from './data/entities'

export function register(container: AppContainer) {
  container.register({
    PhoneCall: asValue(PhoneCall),
    PhoneCallParticipant: asValue(PhoneCallParticipant),
  })
}
