import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportTelemetryError } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  crudFormSectionOutboxScopeSchema, crudFormSectionOutboxServiceKey, type CrudFormSectionOutboxServices,
} from '@open-mercato/shared/lib/crud/form-sections/outbox'
import { getAllIntegrations, type IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { IntegrationHealthService } from '../lib/health-service'
import type { IntegrationStateService } from '../lib/state-service'
import { getEffectiveHealthCheckConfig } from '../lib/health-service'
import { getCrudFormSectionOutboxRuntimes, sweepCrudFormSectionOutbox } from '../lib/crud-form-outbox'

type HealthProbePayload = {
  scope?: IntegrationScope
  organizationId?: string
  tenantId?: string
}

const CHUNK = 5
const logger = createLogger('integrations')

export const metadata: WorkerMeta = {
  queue: 'integration-health-probe',
  id: 'integrations:health-probe',
  concurrency: 5,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

async function mapInChunks<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let index = 0; index < items.length; index += size) {
    const slice = items.slice(index, index + size)
    const batch = await Promise.all(slice.map((item) => fn(item)))
    out.push(...batch)
  }
  return out
}

export default async function handle(job: QueuedJob<HealthProbePayload>, ctx: HandlerContext): Promise<void> {
  const scope: IntegrationScope =
    job.payload.scope
    ?? {
      organizationId: job.payload.organizationId as string,
      tenantId: job.payload.tenantId as string,
    }
  if (!scope.organizationId || !scope.tenantId) {
    return
  }
  const outboxScope = crudFormSectionOutboxScopeSchema.safeParse(scope)
  if (outboxScope.success && getCrudFormSectionOutboxRuntimes().size) {
    try {
      await sweepCrudFormSectionOutbox(
        ctx.resolve<EntityManager>('em'), ctx.resolve<CrudFormSectionOutboxServices>(crudFormSectionOutboxServiceKey), outboxScope.data,
      )
    } catch {
      const error = new Error('[internal] CrudForm outbox recovery sweep failed')
      reportTelemetryError(error, { module: 'integrations', code: 'integrations.crud_form_outbox_sweep_failed' })
      logger.warn('CrudForm outbox recovery sweep failed')
    }
  }
  const stateService = ctx.resolve<IntegrationStateService>('integrationStateService')
  const healthService = ctx.resolve<IntegrationHealthService>('integrationHealthService')

  const candidates: string[] = []
  for (const definition of getAllIntegrations()) {
    const enabled = await stateService.isEnabled(definition.id, scope)
    if (!enabled) continue
    const healthConfig = getEffectiveHealthCheckConfig(definition.id)
    if (!healthConfig?.service) continue
    candidates.push(definition.id)
  }

  await mapInChunks(candidates, CHUNK, async (integrationId) => {
    await healthService.runHealthCheck(integrationId, scope)
  })
}
