import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  deliverEudrNotification,
  type EudrNotificationContainer,
} from '../lib/notifications'

const logger = createLogger('eudr').child({ component: 'notify-statement-submitted' })

export const metadata = {
  event: 'eudr.due_diligence_statement.submitted',
  persistent: true,
  id: 'eudr:notify-statement-submitted',
}

type StatementSubmittedPayload = {
  id?: string
  tenantId?: string | null
  organizationId?: string | null
  title?: string
  occurredAt?: string
}

type SubscriberContext = EudrNotificationContainer & {
  container?: EudrNotificationContainer
}

export default async function notifyStatementSubmitted(
  payload: StatementSubmittedPayload,
  ctx: SubscriberContext,
): Promise<void> {
  if (!payload?.tenantId || !payload.id || !payload.occurredAt || typeof payload.title !== 'string') {
    logger.debug('Skipping statement-submitted notification because the event payload is incomplete')
    return
  }

  await deliverEudrNotification({
    container: ctx.container ?? ctx,
    typeId: 'eudr.statement.submitted',
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
