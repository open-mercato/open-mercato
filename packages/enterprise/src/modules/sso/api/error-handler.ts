import { NextResponse } from 'next/server'
<<<<<<< HEAD
import { SsoAdminAuthError } from './admin-context'
import { SsoConfigError } from '../services/ssoConfigService'
import { isScimTokenError } from '../services/scimTokenService'
import { ScimServiceError } from '../services/scimService'
=======
import { isSsoAdminAuthError } from './admin-context'
import { isSsoConfigError } from '../services/ssoConfigService'
import { isScimTokenError } from '../services/scimTokenService'
import { isScimServiceError } from '../services/scimService'
>>>>>>> b69e252f3f (fix(sso): enforce author privilege ceilings for SSO and SCIM (#10070))
import { scimJson, buildScimError } from '../lib/scim-response'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readSsoErrorTranslation } from '../lib/errors'

const logger = createLogger('sso')

interface SsoHttpError {
  message: string
  statusCode: number
}

function isSsoHttpError(err: unknown): err is SsoHttpError {
  return (
<<<<<<< HEAD
    err instanceof SsoAdminAuthError ||
    err instanceof SsoConfigError ||
    isScimTokenError(err) ||
    err instanceof ScimServiceError
=======
    isSsoAdminAuthError(err) ||
    isSsoConfigError(err) ||
    isScimTokenError(err) ||
    isScimServiceError(err)
>>>>>>> b69e252f3f (fix(sso): enforce author privilege ceilings for SSO and SCIM (#10070))
  )
}

async function resolveSsoHttpErrorMessage(err: SsoHttpError): Promise<string> {
  const translation = readSsoErrorTranslation(err)
  if (!translation) return err.message
  const { translate } = await resolveTranslations()
  return translate(translation.key, err.message, translation.params)
}

export async function ssoErrorResponse(
  key: string,
  fallback: string,
  status: number,
  extra?: Record<string, unknown>,
): Promise<NextResponse> {
  const { translate } = await resolveTranslations()
  return NextResponse.json({ ...extra, error: translate(key, fallback) }, { status })
}

export async function handleSsoAdminApiError(err: unknown, label: string): Promise<NextResponse> {
  if (isCrudHttpError(err)) {
    return NextResponse.json(err.body, { status: err.status })
  }
  if (isSsoHttpError(err)) {
    const message = await resolveSsoHttpErrorMessage(err)
    return NextResponse.json({ error: message }, { status: err.statusCode })
  }
  logger.error('SSO admin API error', { label, err })
  try {
    getTelemetryRuntime()?.reportError(err, { module: 'sso', code: 'sso.admin_api_failed' })
  } catch (telemetryError) {
    logger.warn('SSO telemetry reporting failed', { err: telemetryError })
  }
  return ssoErrorResponse('sso.errors.internal', 'Internal server error', 500)
}

export function handleScimApiError(err: unknown, label: string): Response {
  if (isCrudHttpError(err)) {
    return scimJson(buildScimError(err.status, err.message), err.status)
  }
  if (isScimServiceError(err)) {
    return scimJson(buildScimError(err.statusCode, err.message), err.statusCode)
  }
  logger.error('SCIM API error', { label, err })
  try {
    getTelemetryRuntime()?.reportError(err, { module: 'sso', code: 'sso.scim_api_failed' })
  } catch (telemetryError) {
    logger.warn('SSO telemetry reporting failed', { err: telemetryError })
  }
  return scimJson(buildScimError(500, 'Internal server error'), 500)
}
