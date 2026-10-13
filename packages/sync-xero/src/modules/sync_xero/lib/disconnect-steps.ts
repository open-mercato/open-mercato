import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { XERO_INTEGRATION_ID } from './constants'
import type { XeroScope } from './owner'
import { userHoldsFeatures } from './route-auth'

export type DisconnectStepOutcome = 'ok' | 'failed' | 'skipped'

export type DisconnectSteps = {
  healthCheck: DisconnectStepOutcome
  disable: DisconnectStepOutcome
  removeClientCredentials: DisconnectStepOutcome
}

export const SKIPPED_DISCONNECT_STEPS: DisconnectSteps = { healthCheck: 'skipped', disable: 'skipped', removeClientCredentials: 'skipped' }

const MANAGE_FEATURE = 'integrations.manage'

type HealthRunner = { runHealthCheck(integrationId: string, scope: XeroScope): Promise<unknown> }
type StateWriter = { upsert(integrationId: string, input: { isEnabled: boolean }, scope: XeroScope): Promise<unknown> }

function reportStepFailure(error: unknown, step: keyof DisconnectSteps): void {
  getTelemetryRuntime()?.reportError(error, { module: 'sync_xero', code: `sync_xero.disconnect_${step}_failed` })
}

async function runStep(step: keyof DisconnectSteps, action: () => Promise<void>): Promise<DisconnectStepOutcome> {
  try {
    await action()
    return 'ok'
  } catch (error) {
    reportStepFailure(error, step)
    return 'failed'
  }
}

/**
 * The follow-up of an erased grant (App Spec US-1.2): one health check so the badge shows the
 * disconnect, disabling the integration when the admin may (integrations.manage), and removing the
 * Client ID and Secret on request while keeping every other credential value. A failed step never
 * undoes the erase; it is reported.
 */
export async function runDisconnectSteps(input: {
  container: AppContainer
  req: Request
  userId: string
  scope: XeroScope
  removeClientCredentials: boolean
}): Promise<DisconnectSteps> {
  const { container, req, userId, scope } = input
  const healthCheck = await runStep('healthCheck', async () => {
    await container.resolve<HealthRunner>('integrationHealthService').runHealthCheck(XERO_INTEGRATION_ID, scope)
  })

  let permissionCheckFailed = false
  const mayDisable = await userHoldsFeatures(container, userId, [MANAGE_FEATURE], scope).catch((error: unknown) => {
    reportStepFailure(error, 'disable')
    permissionCheckFailed = true
    return false
  })
  const withoutDisable: DisconnectStepOutcome = permissionCheckFailed ? 'failed' : 'skipped'
  if (!mayDisable && !input.removeClientCredentials) {
    return { healthCheck, disable: withoutDisable, removeClientCredentials: 'skipped' }
  }

  const guard = await runRouteMutationGuards({
    container,
    req,
    auth: { userId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    input: {
      resourceKind: 'integrations.integration',
      resourceId: XERO_INTEGRATION_ID,
      operation: 'update',
      mutationPayload: { ...(mayDisable ? { isEnabled: false } : {}), removeClientCredentials: input.removeClientCredentials },
    },
  }).catch((error: unknown) => {
    reportStepFailure(error, 'disable')
    return null
  })
  if (!guard?.ok) {
    return {
      healthCheck,
      disable: mayDisable ? 'failed' : withoutDisable,
      removeClientCredentials: input.removeClientCredentials ? 'failed' : 'skipped',
    }
  }

  const disable: DisconnectStepOutcome = mayDisable
    ? await runStep('disable', async () => {
        await container.resolve<StateWriter>('integrationStateService').upsert(XERO_INTEGRATION_ID, { isEnabled: false }, scope)
      })
    : withoutDisable
  const removeClientCredentials: DisconnectStepOutcome = input.removeClientCredentials
    ? await runStep('removeClientCredentials', async () => {
        const credentialsService = container.resolve<CredentialsService>('integrationCredentialsService')
        const current = (await credentialsService.getRaw(XERO_INTEGRATION_ID, scope)) ?? {}
        await credentialsService.save(XERO_INTEGRATION_ID, { ...current, clientId: '', clientSecret: '' }, scope)
      })
    : 'skipped'
  if (disable === 'ok' || removeClientCredentials === 'ok') await guard.runAfterSuccess()
  return { healthCheck, disable, removeClientCredentials }
}
