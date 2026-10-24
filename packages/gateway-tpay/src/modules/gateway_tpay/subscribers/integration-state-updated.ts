import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { syncTpayReconciliationSchedule, type ScheduleContainer } from '../lib/reconciliation-schedule'

const logger = createLogger('gateway_tpay')

export const metadata = {
  event: 'integrations.state.updated',
  persistent: true,
  id: 'gateway_tpay:integration-state-updated',
}

type SubscriberContext = ScheduleContainer & {
  tenantId?: string | null
  organizationId?: string | null
}

type IntegrationStateUpdatedPayload = {
  integrationId?: string
  isEnabled?: boolean
  tenantId?: string
  organizationId?: string
}

export default async function handler(
  payload: IntegrationStateUpdatedPayload,
  ctx: SubscriberContext,
): Promise<void> {
  if (payload?.integrationId !== 'gateway_tpay') return
  const tenantId = ctx?.tenantId ?? payload.tenantId
  const organizationId = ctx?.organizationId ?? payload.organizationId
  if (!tenantId || !organizationId || typeof payload.isEnabled !== 'boolean') return
  try {
    await syncTpayReconciliationSchedule({
      container: ctx,
      scope: { tenantId, organizationId },
      enabled: payload.isEnabled,
    })
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, {
      module: 'gateway_tpay',
      code: 'gateway_tpay.reconciliation_schedule_failed',
    })
    logger.warn('Failed to sync Tpay reconciliation schedule', { err: error })
    throw error
  }
}
