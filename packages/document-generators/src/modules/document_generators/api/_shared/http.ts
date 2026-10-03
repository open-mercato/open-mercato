import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { OrganizationScopeRequest, OrganizationScopeService } from '@open-mercato/shared/lib/auth/principal-service'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import type { TranslateParams } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { UnknownTemplateError } from '../../lib/template-registry'
import { TemplateAccessDeniedError } from '../../lib/template-access-policy'

export type TranslateFn = (key: string, fallback?: string) => string

export type DocumentErrorCode =
  | 'invalid_json'
  | 'invalid_query'
  | 'invalid_request'
  | 'unknown_template'
  | 'forbidden'
  | 'organization_required'
  | 'not_found'
  | 'render_failed'

export type TemplateTranslateFn = (key: string, fallbackOrParams?: string | TranslateParams, params?: TranslateParams) => string

export function toTemplateTranslate(translate: TranslateWithFallbackFn): TemplateTranslateFn {
  return (key, fallbackOrParams, params) => (
    typeof fallbackOrParams === 'object' ? translate(key, undefined, fallbackOrParams) : translate(key, fallbackOrParams, params)
  )
}

export type DocumentLogger = Pick<ReturnType<typeof createLogger>, 'error'>

export type OrganizationScope = { tenantId: string; organizationId: string }

export type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; response: Response }

export type OrganizationResult =
  | { ok: true; scope: OrganizationScope; auth: NonNullable<AuthContext> }
  | { ok: false; response: Response }

export type OrganizationScopeContainer = {
  resolve: (name: string) => unknown
}

const DEFAULT_MESSAGES: Record<DocumentErrorCode, string> = {
  invalid_json: 'Invalid JSON body.',
  invalid_query: 'Invalid query parameters.',
  invalid_request: 'Invalid document request.',
  unknown_template: 'Document template not found.',
  forbidden: 'You do not have permission to access this document.',
  organization_required: 'Select an organization to generate documents.',
  not_found: 'Document source not found.',
  render_failed: 'Unable to render the document.',
}

const SOURCE_ERROR_MAP: Record<string, { code: DocumentErrorCode; status: number }> = {
  invalid_request: { code: 'invalid_request', status: 400 },
  not_found: { code: 'not_found', status: 404 },
  organization_scope_required: { code: 'organization_required', status: 409 },
}

const defaultLogger = createLogger('document_generators')

export function errorResponse(
  code: DocumentErrorCode,
  status: number,
  translate: TranslateFn,
  extra?: Record<string, unknown>,
): Response {
  return Response.json(
    { error: code, message: translate(`document_generators.errors.${code}`, DEFAULT_MESSAGES[code]), ...extra },
    { status },
  )
}

export async function parseJsonBody(request: Request, translate: TranslateFn): Promise<JsonBodyResult> {
  try {
    return { ok: true, body: await request.json() }
  } catch {
    return { ok: false, response: errorResponse('invalid_json', 400, translate) }
  }
}

function resolveScopeService(container: OrganizationScopeContainer): OrganizationScopeService | null {
  try {
    const service = container.resolve('organizationScopeService') as Partial<OrganizationScopeService> | null
    return service && typeof service.resolveForRequest === 'function' ? service as OrganizationScopeService : null
  } catch {
    return null
  }
}

function pickOrganization(candidates: Array<string | null | undefined>, allowed: string[] | null): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue
    if (!allowed || allowed.includes(candidate)) return candidate
  }
  return null
}

export async function requireOrganization(input: {
  auth: AuthContext
  container: OrganizationScopeContainer
  request?: OrganizationScopeRequest
  translate: TranslateFn
}): Promise<OrganizationResult> {
  const { auth, container, request, translate } = input
  const missing = (): OrganizationResult => ({ ok: false, response: errorResponse('organization_required', 409, translate) })
  if (!auth?.sub) return missing()
  const activeOrganizationId = resolveActiveOrganizationId(auth)
  const scopeService = resolveScopeService(container)
  const scope = scopeService ? await scopeService.resolveForRequest({ auth, request }) : null
  if (scope?.selectionRejected) return missing()
  const tenantId = scope?.tenantId ?? auth.tenantId
  const allowed = scope ? scope.filterIds ?? scope.allowedIds : null
  const organizationId = pickOrganization([scope?.selectedId, activeOrganizationId], allowed)
  if (!tenantId || !organizationId) return missing()
  return {
    ok: true,
    scope: { tenantId, organizationId },
    auth: { ...auth, tenantId, orgId: organizationId },
  }
}

export function mapDocumentError(
  error: unknown,
  translate: TranslateFn,
  logger: DocumentLogger = defaultLogger,
): Response {
  if (error instanceof UnknownTemplateError) return errorResponse('unknown_template', 400, translate)
  if (error instanceof TemplateAccessDeniedError) {
    return errorResponse('forbidden', 403, translate, { requiredFeatures: error.requiredFeatures })
  }
  if (isCrudHttpError(error)) {
    const sourceCode = typeof error.body?.error === 'string' ? error.body.error : undefined
    const mapped = sourceCode ? SOURCE_ERROR_MAP[sourceCode] : undefined
    if (mapped) return errorResponse(mapped.code, mapped.status, translate)
  }
  logger.error('Document rendering failed', { err: error as Error })
  try {
    getTelemetryRuntime()?.reportError(error, { module: 'document_generators', code: 'document_generators.render_failed' })
  } catch (telemetryError) {
    logger.error('Failed to report a document error to telemetry', { err: telemetryError as Error })
  }
  return errorResponse('render_failed', 500, translate)
}
