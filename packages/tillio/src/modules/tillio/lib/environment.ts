import { randomBytes } from 'node:crypto'
import { z } from 'zod'

export const TILLIO_INTEGRATION_ID = 'tillio'

export const ENV_PROBE_TENANT_DOMAIN = 'test_connection'

export const environmentSchema = z.object({
  apiUrl: z.string().trim().min(1),
  apiKey: z.string().trim().min(1),
  tenantSystemId: z.string().trim().optional(),
})

export type TillioEnvironment = z.infer<typeof environmentSchema>

export function generateTenantSystemId(): string {
  return `OM-${randomBytes(6).toString('hex')}`
}
