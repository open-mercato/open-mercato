import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  deliverEudrNotification,
  type EudrNotificationContainer,
} from '../lib/notifications'

const logger = createLogger('eudr').child({ component: 'notify-mitigation-completed' })

export const metadata = {
  event: 'eudr.mitigation_action.completed',
  persistent: true,
  id: 'eudr:notify-mitigation-completed',
}

type MitigationCompletedPayload = {
  id?: string
  tenantId?: string | null
  organizationId?: string | null
  title?: string
  riskAssessmentId?: string
  occurredAt?: string
}

type SubscriberContext = EudrNotificationContainer & {
  container?: EudrNotificationContainer
}

export default async function notifyMitigationCompleted(
  payload: MitigationCompletedPayload,
  ctx: SubscriberContext,
): Promise<void> {
  if (
    !payload?.tenantId
    || !payload.id
    || !payload.riskAssessmentId
    || !payload.occurredAt
    || typeof payload.title !== 'string'
  ) {
    logger.debug('Skipping mitigation-completed notification because the event payload is incomplete')
    return
  }

  await deliverEudrNotification({
    container: ctx.container ?? ctx,
    typeId: 'eudr.mitigation.completed',
    payload: {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
      entityId: payload.id,
      occurredAt: payload.occurredAt,
      bodyVariables: { actionTitle: payload.title },
      linkHref: `/backend/eudr/risk-assessments/${payload.riskAssessmentId}`,
      sourceEntityType: 'eudr:eudr_mitigation_action',
    },
  })
}
