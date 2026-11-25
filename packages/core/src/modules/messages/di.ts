import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerMessageDealMergeParticipant } from './lib/deal-merge-participant'

registerMessageDealMergeParticipant()

export function register(_container: AppContainer): void {}
