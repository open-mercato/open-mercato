import { NextResponse } from 'next/server'
import { SsoAdminAuthError } from './admin-context'
import { SsoConfigError } from '../services/ssoConfigService'
import { ScimTokenError } from '../services/scimTokenService'
import { ScimServiceError } from '../services/scimService'
import { scimJson, buildScimError } from '../lib/scim-response'

interface SsoHttpError {
  message: string
  statusCode: number
}

function isSsoHttpError(err: unknown): err is SsoHttpError {
  return (
    err instanceof SsoAdminAuthError ||
    err instanceof SsoConfigError ||
    err instanceof ScimTokenError ||
    err instanceof ScimServiceError
  )
}

export function handleSsoAdminApiError(err: unknown, label: string): NextResponse {
  if (isSsoHttpError(err)) {
    return NextResponse.json({ error: err.message }, { status: err.statusCode })
  }
  console.error(`[${label}] Error:`, err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export function handleScimApiError(err: unknown, label: string): Response {
  if (err instanceof ScimServiceError) {
    return scimJson(buildScimError(err.statusCode, err.message), err.statusCode)
  }
  console.error(`[${label}] Error:`, err)
  return scimJson(buildScimError(500, 'Internal server error'), 500)
}
