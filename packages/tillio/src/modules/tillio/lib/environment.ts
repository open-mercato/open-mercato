import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'

// Own key, like the operators blob: saving integration credentials keeps the submitted fields
// plus the schema's secret fields, and the identity is in neither, so it was dropped on every save.
export const TILLIO_ENVIRONMENT_IDENTITY_INTEGRATION_ID = 'tillio_environment'

export const ENV_PROBE_TENANT_DOMAIN = 'test_connection'

export const environmentSchema = z.object({
  apiUrl: z.string().trim().min(1),
  apiKey: z.string().trim().min(1),
  tenantSystemId: z.string().trim().optional(),
})

export type TillioEnvironment = z.infer<typeof environmentSchema>

const identitySchema = z.object({ tenantSystemId: z.string().trim().min(1) })

export type TillioIdentityStore = {
  getRaw: (integrationId: string, scope: IntegrationScope) => Promise<Record<string, unknown> | null>
  save: (integrationId: string, credentials: Record<string, unknown>, scope: IntegrationScope) => Promise<void>
}

export function generateTenantSystemId(): string {
  return `OM-${randomBytes(6).toString('hex')}`
}

export async function readTenantSystemId(
  credentialsService: TillioIdentityStore,
  scope: IntegrationScope,
): Promise<string | null> {
  const raw = await credentialsService.getRaw(TILLIO_ENVIRONMENT_IDENTITY_INTEGRATION_ID, scope)
  const parsed = identitySchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data.tenantSystemId : null
}

export async function saveTenantSystemId(
  credentialsService: TillioIdentityStore,
  scope: IntegrationScope,
  tenantSystemId: string,
): Promise<void> {
  await credentialsService.save(TILLIO_ENVIRONMENT_IDENTITY_INTEGRATION_ID, { tenantSystemId }, scope)
}
