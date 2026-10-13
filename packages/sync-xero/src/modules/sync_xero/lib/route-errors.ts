import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

export const XERO_ROUTE_ERROR_FALLBACKS = {
  unauthorized: 'Sign in to continue.',
  forbidden: 'You do not have access to the Xero connection of this organization.',
  invalid_request: 'The request is invalid.',
  organization_scope_required: 'Select an organization to manage its Xero connection.',
  'xero.not_configured': 'Enter the Xero Client ID and Client Secret on the Credentials tab first.',
  oauth_base_url_not_configured: 'Set APP_URL before connecting to Xero.',
  connect_origin_rejected: 'Open Open Mercato from its configured address (APP_URL) to connect to Xero.',
  missing_secret: 'Xero cannot be connected: the server has no OAuth state key configured.',
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
