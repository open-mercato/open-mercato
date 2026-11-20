import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportTelemetryError } from '@open-mercato/shared/lib/telemetry/runtime'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readBoundedRequestBytes, WebhookBodyTooLargeError } from '@open-mercato/shared/lib/webhooks'
import { crudFormSectionHostKey } from '@open-mercato/shared/lib/crud/form-sections/composition'
import { getCrudFormSectionManifest } from '@open-mercato/shared/lib/crud/form-sections/manifest'
import { encodeCurrentCrudFormSectionPolicyToken } from '@open-mercato/shared/lib/crud/form-sections/policy-token'
import {
  crudFormSectionsPrivateHeaders,
  crudFormSectionsResolveMaxBytes,
  resolveCrudFormSectionsRequestSchema,
  resolveCrudFormSectionsResponseSchema,
  type ResolveCrudFormSectionsResponse,
} from '@open-mercato/shared/lib/crud/form-sections/protocol'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

export const metadata = {
  path: '/extensions/crud-form-sections/resolve',
  POST: { requireAuth: true },
}

const logger = createLogger('auth:crud-form-sections')
const boundedBodies = new WeakMap<Request, Uint8Array>()

function json(data: ResolveCrudFormSectionsResponse | { error: string }, status = 200): Response {
  return Response.json(data, { status, headers: crudFormSectionsPrivateHeaders })
}

async function readBody(request: Request, awaitCancellation = true): Promise<Uint8Array | Response> {
  try {
    return await readBoundedRequestBytes(request, { maxBytes: crudFormSectionsResolveMaxBytes, awaitCancellation })
  } catch (error) {
    if (error instanceof WebhookBodyTooLargeError) return json({ error: 'payload_too_large' }, 413)
    return json({ error: 'invalid_request' }, 400)
  }
}

export async function beforeAuth(request: Request): Promise<Response | null> {
  const body = await readBody(request.clone(), false)
  if (body instanceof Response) return body
  boundedBodies.set(request, body)
  return null
}

function parseBody(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return null
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await getAuthFromRequest(request)
  if (!auth) return json({ error: 'unauthorized' }, 401)

  const body = boundedBodies.get(request) ?? await readBody(request)
  boundedBodies.delete(request)
  if (body instanceof Response) return body
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: 'invalid_request' }, 400)
  }

  const parsed = resolveCrudFormSectionsRequestSchema.safeParse(parseBody(body))
  if (!parsed.success) return json({ error: 'invalid_request' }, 400)
  const { hostId, formVariant, formOperation, hostResourceKind, hostResourceId, clientManifestFingerprint, clientRoundTripIds } = parsed.data
  const address = { hostId, formVariant, formOperation }
  const hostKey = crudFormSectionHostKey(address)
  const manifest = getCrudFormSectionManifest()
  const provider = manifest.providers.get(hostKey)
  if (!provider || provider.hostResourceKind !== hostResourceKind) return json({ error: 'not_found' }, 404)

  const policy = manifest.policies.get(hostKey)
  const container = await createRequestContainer()
  const requiredFeatures = [...(policy?.requireFeatures ?? provider.requireFeatures)]
  const { scope, organizationId, allowedOrganizationIds } = await resolveFeatureCheckContext({
    container, auth, request, requiredFeatures,
  })
  if (!scope.tenantId) {
    return json({ error: 'not_found' }, 404)
  }
  const rbac = container.resolve<RbacService>('rbacService')
  if (!await rbac.userHasAllFeatures(auth.sub, requiredFeatures, { tenantId: scope.tenantId, organizationId })) {
    return json({ error: 'forbidden' }, 403)
  }
  if (allowedOrganizationIds && !allowedOrganizationIds.length) return json({ error: 'not_found' }, 404)

  let authorized
  try {
    authorized = await provider.authorizeHost({
      auth, container, address,
      scope: { tenantId: scope.tenantId, organizationId, allowedOrganizationIds },
      requestedHost: { hostResourceKind, hostResourceId },
    })
  } catch {
    const error = new Error('[internal] CrudForm section host authorization failed')
    reportTelemetryError(error, { module: 'auth', code: 'crud_form_sections.host_authorization_failed', attributes: address })
    logger.error('CrudForm section host authorization failed', address)
    return json({ error: 'not_found' }, 404)
  }
  if (!authorized || authorized.hostResourceKind !== hostResourceKind || authorized.hostResourceId !== hostResourceId) {
    return json({ error: 'not_found' }, 404)
  }

  function failed(reason: string): Response {
    logger.warn('CrudForm section policy resolution failed', { ...address, reason })
    return json({ state: 'failed', code: 'crud_form_section_policy_invalid' })
  }

  if (!policy || clientManifestFingerprint !== policy.clientFingerprint
      || clientRoundTripIds.length !== policy.roundTripIds.length
      || clientRoundTripIds.some((id, index) => id !== policy.roundTripIds[index])) {
    return failed('policy_or_bundle_mismatch')
  }
  const fingerprint = manifest.ledger.fingerprint
  const policyToken = encodeCurrentCrudFormSectionPolicyToken({ address, host: authorized, policy, fingerprint })
  if (!policyToken) return failed('policy_token_too_large')
  const response = resolveCrudFormSectionsResponseSchema.safeParse({
    state: 'ready',
    fingerprint,
    policyToken,
    activeSectionIds: [...policy.surface.orderedSectionIds].sort(),
    acceptedContributionIds: [...policy.surface.contributionIds],
  })
  return response.success ? json(response.data) : failed('invalid_manifest_response')
}

const errorResponseSchema = z.object({ error: z.string() }).strict()

export const openApi: OpenApiRouteDoc = {
  summary: 'Resolve the accepted CrudForm section policy',
  methods: {
    POST: {
      summary: 'Resolve the accepted CrudForm section policy',
      tags: ['Extensions'],
      requestBody: { contentType: 'application/json', schema: resolveCrudFormSectionsRequestSchema, description: 'At most 16 KiB.' },
      responses: [{ status: 200, description: 'Ready or failed policy', schema: resolveCrudFormSectionsResponseSchema }],
      errors: [
        { status: 400, description: 'Malformed or non-canonical request', schema: errorResponseSchema },
        { status: 401, description: 'Authentication required', schema: errorResponseSchema },
        { status: 403, description: 'Required provider feature missing', schema: errorResponseSchema },
        { status: 404, description: 'Host resource unavailable', schema: errorResponseSchema },
        { status: 413, description: 'Request body exceeds 16 KiB', schema: errorResponseSchema },
      ],
    },
  },
}
