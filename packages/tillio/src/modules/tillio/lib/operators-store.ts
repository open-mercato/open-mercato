import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'

// Own key in the credentials store rather than a table: `integration_credentials.integration_id` is
// plain text with no registry lookup, so a provider key is accepted and the token inherits the
// store's encryption. Distinct from TILLIO_INTEGRATION_ID so detaching never touches the environment.
export const TILLIO_OPERATORS_INTEGRATION_ID = 'tillio_operators'

export const operatorPluginSchema = z.enum(['Ringostat'])
export type TillioOperatorPlugin = z.infer<typeof operatorPluginSchema>

export const ringostatConfigSchema = z.object({
  key: z.string().trim().min(1),
})

export const operatorRecordSchema = z.object({
  id: z.string().trim().min(1),
  plugin: operatorPluginSchema,
  label: z.string().trim().optional(),
  config: z.record(z.string(), z.unknown()),
  token: z.string().trim().min(1),
  tenantDomain: z.string().trim().min(1),
  envFingerprint: z.string().trim().min(1),
})
export type TillioOperatorRecord = z.infer<typeof operatorRecordSchema>

export const operatorsBlobSchema = z.object({
  operators: z.array(operatorRecordSchema).default([]),
  defaultOperatorId: z.string().trim().nullable().default(null),
})
export type TillioOperatorsBlob = z.infer<typeof operatorsBlobSchema>

const EMPTY_BLOB: TillioOperatorsBlob = { operators: [], defaultOperatorId: null }

export type TillioCredentialsService = {
  getRaw: (integrationId: string, scope: IntegrationScope) => Promise<Record<string, unknown> | null>
  save: (integrationId: string, credentials: Record<string, unknown>, scope: IntegrationScope) => Promise<void>
}

export function computeEnvFingerprint(env: { tenantSystemId: string; apiUrl: string; apiKey: string }): string {
  return createHash('sha256').update(`${env.tenantSystemId}\n${env.apiUrl}\n${env.apiKey}`).digest('hex')
}

export function resolveAppHost(appUrl: string): string {
  const trimmed = appUrl.trim()
  if (!trimmed) return ''
  try {
    return new URL(trimmed).host
  } catch {
    return trimmed.replace(/^\/+/, '').split('/')[0] ?? ''
  }
}

export function buildTenantDomain(appUrl: string, tenantSystemId: string, operatorId: string): string {
  const host = resolveAppHost(appUrl)
  if (!host) throw new Error('[internal] APP_URL is not configured; cannot build the Tillio X-Tenant-Domain.')
  return `${host}/${tenantSystemId}-${operatorId}`
}

export async function readOperatorsBlob(
  credentialsService: TillioCredentialsService,
  scope: IntegrationScope,
): Promise<TillioOperatorsBlob> {
  const raw = await credentialsService.getRaw(TILLIO_OPERATORS_INTEGRATION_ID, scope)
  const parsed = operatorsBlobSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : EMPTY_BLOB
}

export async function saveOperatorsBlob(
  credentialsService: TillioCredentialsService,
  scope: IntegrationScope,
  blob: TillioOperatorsBlob,
): Promise<void> {
  await credentialsService.save(TILLIO_OPERATORS_INTEGRATION_ID, blob, scope)
}
