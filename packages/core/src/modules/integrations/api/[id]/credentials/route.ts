import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { emitIntegrationsEvent } from '../../../events'
import { saveCredentialsSchema } from '../../../data/validators'
import {
  isCredentialsEncryptionUnavailableError,
  isCredentialsSealedWhileDisabledError,
  type CredentialsService,
} from '../../../lib/credentials-service'
import { collectCredentialUrlValidationErrors } from '../../../lib/credentials-field-validation'
import {
  maskSecretCredentials,
  mergeMaskedSecretCredentials,
} from '../../../lib/credentials-masking'
import {
  resolveUserFeatures,
  runIntegrationMutationGuardAfterSuccess,
  runIntegrationMutationGuards,
} from '../../guards'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'

const idParamsSchema = z.object({ id: z.string().min(1) })

const logger = createLogger('integrations').child({ component: 'credentials-route' })

/**
 * Credentials sealed before `TENANT_DATA_ENCRYPTION` was switched off cannot be opened by any key,
 * and nothing unseals them for the operator: `mercato entities decrypt-database` decrypts the
 * columns an encryption map covers, while this envelope sits *inside* the decrypted `credentials`
 * value. Re-entering them is the only remedy, so the admin surface has to stay usable — a 503 on
 * both the read and the save would leave the integration permanently unfixable from the UI.
 *
 * The form therefore loads as if nothing were configured. Adapters keep seeing the error, since
 * they read through the service directly.
 */
function reportSealedCredentials(integrationId: string, tenantId: string): void {
  logger.warn(
    'Integration credentials are sealed under an encryption key that is no longer available '
      + '(TENANT_DATA_ENCRYPTION was switched off after they were saved). The admin form will show '
      + 'them as unconfigured; re-save the credentials to store them in the clear.',
    { integrationId, tenantId },
  )
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['integrations.credentials.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['integrations.credentials.manage'] },
}

export const openApi = {
  tags: ['Integrations'],
  summary: 'Get or save integration credentials',
}

function resolveParams(ctx: { params?: Promise<{ id?: string }> | { id?: string } }): Promise<{ id?: string } | undefined> | { id?: string } | undefined {
  if (!ctx.params) return undefined
  if (typeof (ctx.params as Promise<unknown>).then === 'function') {
    return ctx.params as Promise<{ id?: string }>
  }
  return ctx.params as { id?: string }
}

export async function GET(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) {
    return organizationScopeRequiredResponse()
  }

  const rawParams = await resolveParams(ctx)
  const parsedParams = idParamsSchema.safeParse(rawParams)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid integration id' }, { status: 400 })
  }

  const integration = getIntegration(parsedParams.data.id)
  if (!integration) {
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
  }

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
  const scope = { organizationId: organizationId, tenantId: auth.tenantId }

  let values: Record<string, unknown> | null
  let updatedAt: Date | null
  try {
    values = await credentialsService.resolve(integration.id, scope)
    updatedAt = await credentialsService.resolveUpdatedAt(integration.id, scope)
  } catch (error) {
    if (isCredentialsSealedWhileDisabledError(error)) {
      reportSealedCredentials(integration.id, auth.tenantId)
      values = null
      updatedAt = await credentialsService.resolveUpdatedAt(integration.id, scope)
    } else if (isCredentialsEncryptionUnavailableError(error)) {
      return NextResponse.json({ error: 'Integration credentials encryption is unavailable' }, { status: 503 })
    } else {
      throw error
    }
  }

  const schema = credentialsService.getSchema(integration.id)
  const { credentials, secretFieldsConfigured } = maskSecretCredentials(schema, values ?? {})

  return NextResponse.json({
    integrationId: integration.id,
    schema,
    credentials,
    secretFieldsConfigured,
    updatedAt: updatedAt?.toISOString() ?? null,
  })
}

export async function PUT(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) {
    return organizationScopeRequiredResponse()
  }

  const rawParams = await resolveParams(ctx)
  const parsedParams = idParamsSchema.safeParse(rawParams)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid integration id' }, { status: 400 })
  }

  const integration = getIntegration(parsedParams.data.id)
  if (!integration) {
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
  }

  const payload = await req.json().catch(() => null)
  const parsedBody = saveCredentialsSchema.safeParse(payload)
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid credentials payload', details: parsedBody.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const guardResult = await runIntegrationMutationGuards(
    container,
    {
    tenantId: auth.tenantId,
    organizationId,
    userId: auth.sub ?? '',
    resourceKind: 'integrations.integration',
    resourceId: integration.id,
    operation: 'update',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: parsedBody.data as Record<string, unknown>,
    },
    resolveUserFeatures(auth),
  )
  if (!guardResult.ok) {
    return NextResponse.json(guardResult.errorBody ?? { error: 'Operation blocked by guard' }, { status: guardResult.errorStatus ?? 422 })
  }

  let payloadData = parsedBody.data
  if (guardResult.modifiedPayload) {
    const mergedPayload = { ...parsedBody.data, ...guardResult.modifiedPayload }
    const reparsed = saveCredentialsSchema.safeParse(mergedPayload)
    if (!reparsed.success) {
      return NextResponse.json({ error: 'Invalid credentials payload after guard transform', details: reparsed.error.flatten() }, { status: 422 })
    }
    payloadData = reparsed.data
  }

  const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
  const scope = { organizationId: organizationId, tenantId: auth.tenantId }
  const schema = credentialsService.getSchema(integration.id)

  try {
    const currentUpdatedAt = await credentialsService.resolveUpdatedAt(integration.id, scope)
    enforceCommandOptimisticLock({
      resourceKind: 'integrations.integration',
      resourceId: integration.id,
      current: currentUpdatedAt,
      request: req,
    })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (isCredentialsEncryptionUnavailableError(error)) {
      return NextResponse.json({ error: 'Integration credentials encryption is unavailable' }, { status: 503 })
    }
    throw error
  }

  const credentialFieldErrors = collectCredentialUrlValidationErrors(
    schema,
    payloadData.credentials,
  )
  if (Object.keys(credentialFieldErrors).length > 0) {
    return NextResponse.json(
      { error: 'Invalid credentials payload', details: { fieldErrors: credentialFieldErrors } },
      { status: 422 },
    )
  }

  try {
    let existing: Record<string, unknown> | null = null
    try {
      existing = await credentialsService.resolve(integration.id, scope)
    } catch (error) {
      // Nothing to merge against, but the save itself must go through: this is the state the
      // re-entry is meant to escape from.
      if (!isCredentialsSealedWhileDisabledError(error)) throw error
      reportSealedCredentials(integration.id, auth.tenantId)
    }
    const credentialsToSave = mergeMaskedSecretCredentials(
      schema,
      payloadData.credentials,
      existing ?? {},
      payloadData.unchangedSecretFields,
    )
    await credentialsService.save(integration.id, credentialsToSave, scope)
  } catch (error) {
    if (isCredentialsEncryptionUnavailableError(error)) {
      return NextResponse.json({ error: 'Integration credentials encryption is unavailable' }, { status: 503 })
    }
    throw error
  }

  await emitIntegrationsEvent('integrations.credentials.updated', {
    integrationId: integration.id,
    tenantId: auth.tenantId,
    organizationId,
    userId: auth.sub,
  })

  await runIntegrationMutationGuardAfterSuccess(guardResult.afterSuccessCallbacks, {
      tenantId: auth.tenantId,
      organizationId,
      userId: auth.sub ?? '',
      resourceKind: 'integrations.integration',
      resourceId: integration.id,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
    })

  return NextResponse.json({ ok: true })
}
