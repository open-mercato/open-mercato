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
import { resolveIntegrationsOrganizationId } from '../../../lib/organization-scope'

const idParamsSchema = z.object({ id: z.string().min(1) })

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
  const organizationId = resolveIntegrationsOrganizationId(auth)
  if (!auth?.tenantId || !organizationId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    if (isCredentialsEncryptionUnavailableError(error)) {
      return NextResponse.json({ error: 'Integration credentials encryption is unavailable' }, { status: 503 })
    }
    throw error
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
  const organizationId = resolveIntegrationsOrganizationId(auth)
  if (!auth?.tenantId || !organizationId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    // Secret fields are returned masked on GET; when the client round-trips the
    // mask sentinel it means "unchanged", so restore the existing stored secret
    // instead of overwriting it with the placeholder.
    const existing = await credentialsService.resolve(integration.id, scope)
    const credentialsToSave = mergeMaskedSecretCredentials(schema, payloadData.credentials, existing ?? {})
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
