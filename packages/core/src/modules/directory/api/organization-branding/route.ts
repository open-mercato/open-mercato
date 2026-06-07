import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { organizationUpdateSchema } from '@open-mercato/core/modules/directory/data/validators'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import '@open-mercato/core/modules/directory/commands/organizations'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['directory.organizations.view'] },
  PUT: { requireAuth: true, requireFeatures: ['directory.organizations.manage'] },
}

const brandingResponseSchema = z.object({
  organizationId: z.string().uuid(),
  organizationName: z.string(),
  tenantId: z.string().uuid(),
  logoUrl: z.string().nullable(),
})

const brandingUpdateSchema = z.object({
  logoUrl: organizationUpdateSchema.shape.logoUrl,
})

const errorSchema = z.object({
  error: z.string(),
})

type RequestContainer = Awaited<ReturnType<typeof createRequestContainer>>

function buildCommandContext(
  container: RequestContainer,
  auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>,
  req: Request,
  organizationId: string,
  tenantId: string,
): CommandRuntimeContext {
  return {
    container,
    auth,
    organizationScope: {
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: null,
      tenantId,
    },
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: req,
  }
}

async function resolveCurrentOrganization(req: Request) {
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return {
      response: NextResponse.json({ error: translate('api.errors.unauthorized', 'Unauthorized') }, { status: 401 }),
    }
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope.selectedId ?? auth.orgId ?? null
  const tenantId = scope.tenantId ?? auth.tenantId ?? null
  if (!organizationId || !tenantId) {
    return {
      response: NextResponse.json(
        {
          error: translate(
            'directory.branding.errors.organizationRequired',
            'Select a single organization before changing sidebar branding.',
          ),
        },
        { status: 400 },
      ),
    }
  }

  const em = container.resolve('em') as EntityManager
  const organization = await findOneWithDecryption(
    em,
    Organization,
    { id: organizationId, tenant: tenantId, deletedAt: null },
    { populate: ['tenant'] },
    { tenantId, organizationId },
  )
  if (!organization) {
    return {
      response: NextResponse.json(
        { error: translate('directory.branding.errors.notFound', 'Organization not found') },
        { status: 404 },
      ),
    }
  }

  return { auth, container, organization, organizationId, tenantId, translate }
}

function toResponsePayload(organization: Organization, tenantId: string) {
  return {
    organizationId: String(organization.id),
    organizationName: organization.name,
    tenantId,
    logoUrl: organization.logoUrl ?? null,
  }
}

async function invalidateSidebarBrandingCache(container: RequestContainer, organizationId: string, tenantId: string) {
  try {
    const cache = container.resolve('cache') as {
      deleteByTags?: (tags: string[]) => Promise<void>
    } | null
    await cache?.deleteByTags?.([
      `nav:sidebar:organization:${organizationId}`,
      `nav:sidebar:tenant:${tenantId}`,
    ])
  } catch {
    // Cache invalidation is best-effort; the persisted branding is the source of truth.
  }
}

export async function GET(req: Request) {
  const resolved = await resolveCurrentOrganization(req)
  if ('response' in resolved) return resolved.response

  return NextResponse.json(toResponsePayload(resolved.organization, resolved.tenantId))
}

export async function PUT(req: Request) {
  const resolved = await resolveCurrentOrganization(req)
  if ('response' in resolved) return resolved.response

  const body = await req.json().catch(() => ({}))
  const parsed = brandingUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: resolved.translate('directory.branding.errors.invalidLogoUrl', 'Enter a valid image URL.'),
        issues: parsed.error.issues,
      },
      { status: 422 },
    )
  }

  try {
    const commandBus = resolved.container.resolve('commandBus') as CommandBus
    const ctx = buildCommandContext(
      resolved.container,
      resolved.auth,
      req,
      resolved.organizationId,
      resolved.tenantId,
    )
    const { result } = await commandBus.execute<Record<string, unknown>, Organization>(
      'directory.organizations.update',
      {
        input: {
          id: resolved.organizationId,
          tenantId: resolved.tenantId,
          logoUrl: parsed.data.logoUrl ?? null,
        },
        ctx,
      },
    )
    await invalidateSidebarBrandingCache(resolved.container, resolved.organizationId, resolved.tenantId)
    return NextResponse.json(toResponsePayload(result, resolved.tenantId))
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('directory.organization-branding.update failed', err)
    return NextResponse.json(
      { error: resolved.translate('directory.branding.errors.save', 'Failed to update organization branding.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Directory',
  summary: 'Current organization branding',
  methods: {
    GET: {
      summary: 'Read sidebar branding for the selected organization',
      description: 'Returns the logo URL used by the backend sidebar for the currently selected organization.',
      responses: [
        { status: 200, description: 'Organization branding', schema: brandingResponseSchema },
      ],
      errors: [
        { status: 400, description: 'A concrete organization scope is required', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Organization not found', schema: errorSchema },
      ],
    },
    PUT: {
      summary: 'Update sidebar branding for the selected organization',
      description: 'Stores an external image URL or an internal attachment image URL as the selected organization logo.',
      requestBody: {
        contentType: 'application/json',
        schema: brandingUpdateSchema,
      },
      responses: [
        { status: 200, description: 'Updated organization branding', schema: brandingResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Save failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 422, description: 'Invalid logo URL', schema: errorSchema },
      ],
    },
  },
}
