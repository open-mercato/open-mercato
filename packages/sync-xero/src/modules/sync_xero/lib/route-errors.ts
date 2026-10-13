import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { OAuthGrantError } from '@open-mercato/core/modules/integrations/lib/oauth/descriptor'
import { XeroApiError } from './errors'

export const XERO_ROUTE_ERROR_FALLBACKS = {
  unauthorized: 'Sign in to continue.',
  forbidden: 'You do not have access to the Xero connection of this organization.',
  invalid_request: 'The request is invalid.',
  organization_scope_required: 'Select an organization to manage its Xero connection.',
  'xero.not_configured': 'Enter the Xero Client ID and Client Secret on the Credentials tab first.',
  oauth_base_url_not_configured: 'Set APP_URL before connecting to Xero.',
  connect_origin_rejected: 'Open Open Mercato from its configured address (APP_URL) to connect to Xero.',
  missing_secret: 'Xero cannot be connected: the server has no OAuth state key configured.',
  not_connected: 'Connect to Xero first.',
  transient: 'The Xero connection is temporarily unavailable. Try again in a moment.',
  platform_unavailable: 'The stored Xero connection cannot be read right now. Try again later.',
  'xero.account_unavailable': 'Open Mercato cannot use the Xero connection. Reconnect to Xero.',
  'xero.client_misconfigured': 'Xero rejected the Client ID or Secret. Check them on the Credentials tab.',
  'xero.unavailable': 'Xero did not answer in time. Try again in a moment.',
  'xero.organisation_not_authorised': 'This Xero Organisation is not part of the connection. Reconnect and select it in Xero.',
  'xero.organisation_change_confirmation_required': 'Confirm the change of Xero Organisation.',
  'xero.organisation_switch_blocked': 'The Xero Organisation cannot be changed while invoices are linked to the previous one.',
  disconnect_tokens_unreadable: 'The stored Xero connection cannot be read. Use Disconnect anyway.',
} as const

export type XeroRouteErrorCode = keyof typeof XERO_ROUTE_ERROR_FALLBACKS

export function xeroErrorTranslationKey(code: string): string {
  return `sync_xero.errors.${code.replace(/^xero\./, '')}`
}

export async function translateXeroText(key: string, fallback: string): Promise<string> {
  try {
    const { translate } = await resolveTranslations()
    return translate(key, fallback)
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, { module: 'sync_xero', code: 'sync_xero.translation_unavailable' })
    return fallback
  }
}

export async function xeroErrorResponse(
  status: number,
  code: XeroRouteErrorCode,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  const error = await translateXeroText(xeroErrorTranslationKey(code), XERO_ROUTE_ERROR_FALLBACKS[code])
  return Response.json({ ...extra, error, code }, { status })
}

/**
 * Maps a failure of an interactive Xero call made inside an admin's request (App Spec § 6.5): no
 * grant is not_connected; a rejected client is xero.client_misconfigured, fixed on the Credentials
 * tab, never by a reconnect; a transient or platform failure is a 503 to retry; any other token
 * failure is xero.account_unavailable (reconnect); any Xero API failure is xero.unavailable.
 * Returns null for anything else.
 */
export async function interactiveFailureResponse(error: unknown): Promise<Response | null> {
  if (error instanceof OAuthGrantError) {
    if (error.code === 'not_connected') return xeroErrorResponse(409, 'not_connected')
    if (error.code === 'client_misconfigured') return xeroErrorResponse(409, 'xero.client_misconfigured')
    if (error.code === 'transient') return xeroErrorResponse(503, 'transient')
    if (error.code === 'platform_unavailable') return xeroErrorResponse(503, 'platform_unavailable')
    return xeroErrorResponse(409, 'xero.account_unavailable')
  }
  if (error instanceof XeroApiError) return xeroErrorResponse(503, 'xero.unavailable')
  return null
}
