import { NextResponse } from 'next/server'
import { isSsoAdminAuthError } from './admin-context'
import { isSsoConfigError } from '../services/ssoConfigService'
import { isScimTokenError } from '../services/scimTokenService'
import { isScimServiceError } from '../services/scimService'
import { scimJson, buildScimError } from '../lib/scim-response'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const logger = createLogger('sso')

interface SsoHttpError {
  message: string
  statusCode: number
}

function isSsoHttpError(err: unknown): err is SsoHttpError {
  return (
    isSsoAdminAuthError(err) ||
    isSsoConfigError(err) ||
    isScimTokenError(err) ||
    isScimServiceError(err)
  )
}

export function handleSsoAdminApiError(err: unknown, label: string): NextResponse {
  if (isCrudHttpError(err)) {
    return NextResponse.json(err.body, { status: err.status })
  }
  if (isSsoHttpError(err)) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode })
  }
  logger.error('SSO admin API error', { label, err })
  try {
    getTelemetryRuntime()?.reportError(err, { module: 'sso', code: 'sso.admin_api_failed' })
  } catch (telemetryError) {
    logger.warn('SSO telemetry reporting failed', { err: telemetryError })
  }
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
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
