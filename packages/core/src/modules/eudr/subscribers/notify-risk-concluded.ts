import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  deliverEudrNotification,
  type EudrNotificationContainer,
} from '../lib/notifications'

const logger = createLogger('eudr').child({ component: 'notify-risk-concluded' })

export const metadata = {
  event: 'eudr.risk_assessment.concluded',
  persistent: true,
  id: 'eudr:notify-risk-concluded',
}

type RiskConcludedPayload = {
  id?: string
  tenantId?: string | null
  organizationId?: string | null
  statementId?: string
  statementTitle?: string
  conclusion?: string
  occurredAt?: string
}

type SubscriberContext = EudrNotificationContainer & {
  container?: EudrNotificationContainer
}

export default async function notifyRiskConcluded(
  payload: RiskConcludedPayload,
  ctx: SubscriberContext,
): Promise<void> {
  if (payload?.conclusion !== 'non_negligible') return
  if (
    !payload.tenantId
    || !payload.id
    || !payload.statementId
    || !payload.occurredAt
    || typeof payload.statementTitle !== 'string'
  ) {
    logger.debug('Skipping risk-concluded notification because the event payload is incomplete')
    return
  }

  await deliverEudrNotification({
    container: ctx.container ?? ctx,
    typeId: 'eudr.risk.non_negligible',
    payload: {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
      entityId: payload.id,
      occurredAt: payload.occurredAt,
      bodyVariables: { statementTitle: payload.statementTitle },
      linkHref: `/backend/eudr/statements/${payload.statementId}`,
      sourceEntityType: 'eudr:eudr_risk_assessment',
    },
  })
}
