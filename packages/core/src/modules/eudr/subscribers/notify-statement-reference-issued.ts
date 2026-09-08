import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  deliverEudrNotification,
  type EudrNotificationContainer,
} from '../lib/notifications'

const logger = createLogger('eudr').child({ component: 'notify-statement-reference-issued' })

export const metadata = {
  event: 'eudr.due_diligence_statement.reference_issued',
  persistent: true,
  id: 'eudr:notify-statement-reference-issued',
}

type StatementReferenceIssuedPayload = {
  id?: string
  tenantId?: string | null
  organizationId?: string | null
  title?: string
  referenceNumber?: string
  occurredAt?: string
}

type SubscriberContext = EudrNotificationContainer & {
  container?: EudrNotificationContainer
}

export default async function notifyStatementReferenceIssued(
  payload: StatementReferenceIssuedPayload,
  ctx: SubscriberContext,
): Promise<void> {
  if (
    !payload?.tenantId
    || !payload.id
    || !payload.occurredAt
    || typeof payload.title !== 'string'
    || typeof payload.referenceNumber !== 'string'
  ) {
    logger.debug('Skipping reference-issued notification because the event payload is incomplete')
    return
  }

  await deliverEudrNotification({
    container: ctx.container ?? ctx,
    typeId: 'eudr.statement.reference_issued',
    payload: {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
      entityId: payload.id,
      occurredAt: payload.occurredAt,
      bodyVariables: {
        statementTitle: payload.title,
        referenceNumber: payload.referenceNumber,
      },
      linkHref: `/backend/eudr/statements/${payload.id}`,
      sourceEntityType: 'eudr:eudr_due_diligence_statement',
    },
  })
}
