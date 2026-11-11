import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import { XERO_INTEGRATION_ID } from './constants'
import type { XeroScope } from './owner'

export type XeroClientConfiguration = { clientId: string; clientSecret: string }

function readNonBlank(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function readXeroClientConfiguration(
  credentialsService: Pick<CredentialsService, 'resolve'>,
  scope: XeroScope,
): Promise<XeroClientConfiguration | null> {
  const credentials = await credentialsService.resolve(XERO_INTEGRATION_ID, scope)
  const clientId = readNonBlank(credentials?.clientId)
  const clientSecret = readNonBlank(credentials?.clientSecret)
  return clientId && clientSecret ? { clientId, clientSecret } : null
}
