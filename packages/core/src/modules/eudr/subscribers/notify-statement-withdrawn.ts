import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  deliverEudrNotification,
  type EudrNotificationContainer,
} from '../lib/notifications'

const logger = createLogger('eudr').child({ component: 'notify-statement-withdrawn' })

export const metadata = {
  event: 'eudr.due_diligence_statement.withdrawn',
  persistent: true,
  id: 'eudr:notify-statement-withdrawn',
}

type StatementWithdrawnPayload = {
  id?: string
  tenantId?: string | null
  organizationId?: string | null
  title?: string
  occurredAt?: string
}

type SubscriberContext = EudrNotificationContainer & {
  container?: EudrNotificationContainer
}

export default async function notifyStatementWithdrawn(
  payload: StatementWithdrawnPayload,
  ctx: SubscriberContext,
): Promise<void> {
  if (!payload?.tenantId || !payload.id || !payload.occurredAt || typeof payload.title !== 'string') {
    logger.debug('Skipping statement-withdrawn notification because the event payload is incomplete')
    return
  }

  await deliverEudrNotification({
    container: ctx.container ?? ctx,
    typeId: 'eudr.statement.withdrawn',
    payload: {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
      entityId: payload.id,
      occurredAt: payload.occurredAt,
      bodyVariables: { statementTitle: payload.title },
      linkHref: `/backend/eudr/statements/${payload.id}`,
      sourceEntityType: 'eudr:eudr_due_diligence_statement',
    },
  })
}
