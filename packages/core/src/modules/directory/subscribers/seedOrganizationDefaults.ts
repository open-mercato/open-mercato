import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('directory')

type OrganizationCreatedContext = {
  resolve: <T = unknown>(name: string) => T
  tenantId?: string | null
  organizationId?: string | null
}

function createSeedContainer(
  ctx: OrganizationCreatedContext,
  em: EntityManager,
): AwilixContainer {
  const resolve = <T = unknown>(name: string): T => {
    if (name === 'em') return em as T
    return ctx.resolve<T>(name)
  }

  return {
    resolve,
    hasRegistration: (name: string) => {
      try {
        resolve(name)
        return true
      } catch {
        return false
      }
    },
  } as unknown as AwilixContainer
}

export const metadata = {
  event: 'directory.organization.created',
  persistent: true,
  id: 'directory:seed-organization-defaults',
}

export default async function seedOrganizationDefaults(
  _payload: unknown,
  ctx: OrganizationCreatedContext,
): Promise<void> {
  const tenantId = typeof ctx.tenantId === 'string' ? ctx.tenantId : null
  const organizationId = typeof ctx.organizationId === 'string' ? ctx.organizationId : null
  if (!tenantId || !organizationId) return

  const rootEm = ctx.resolve<EntityManager>('em')
  const failures: unknown[] = []
  for (const moduleEntry of getModules()) {
    const onOrganizationCreated = moduleEntry.setup?.onOrganizationCreated
    if (!onOrganizationCreated) continue

    const em = rootEm.fork()
    try {
      await onOrganizationCreated({
        em,
        tenantId,
        organizationId,
        container: createSeedContainer(ctx, em),
      })
    } catch (error) {
      failures.push(error)
      logger.error('Organization defaults provisioning failed', {
        moduleId: moduleEntry.id,
        tenantId,
        organizationId,
        err: error,
      })
      getTelemetryRuntime()?.reportError(error, {
        module: 'directory',
        code: 'directory.organization_defaults_provisioning_failed',
        attributes: { moduleId: moduleEntry.id, tenantId, organizationId },
      })
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, 'One or more organization default hooks failed')
  }
}
