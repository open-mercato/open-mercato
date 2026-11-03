import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveAssigneeDisplayNames } from '../../lib/assigneeNames'

const logger = createLogger('warranty_claims')

export const MAX_ASSIGNEE_LOOKUP_IDS = 100

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const querySchema = z.object({
  ids: z.string().min(1),
}).strict()

const responseSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    name: z.string().nullable(),
  })),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['warranty_claims.claim.view'] },
}

export function parseRequestedIds(raw: string): string[] {
  const deduped = new Set<string>()
  for (const value of parseCommaSeparatedList(raw)) {
    if (UUID_REGEX.test(value)) deduped.add(value)
  }
  return [...deduped].slice(0, MAX_ASSIGNEE_LOOKUP_IDS)
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const url = new URL(req.url)
    const parsedQuery = querySchema.parse(Object.fromEntries(url.searchParams))
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      throw new CrudHttpError(401, { error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope.tenantId ?? auth.tenantId
    if (!tenantId) {
      throw new CrudHttpError(401, { error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
    }

    const requestedIds = parseRequestedIds(parsedQuery.ids)
    if (!requestedIds.length) return NextResponse.json({ items: [] })

    const displayNames = await resolveAssigneeDisplayNames({
      container,
      tenantId,
      organizationId: scope.selectedId,
      organizationIds: scope.filterIds,
    }, requestedIds)
    const items = requestedIds.flatMap((id) => {
      const name = displayNames.get(id)
      return name ? [{ id, name }] : []
    })
    return NextResponse.json({ items })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('[warranty_claims] Failed to resolve assignee display names', { error })
    return NextResponse.json({ error: translate('warranty_claims.errors.load_failed', 'Failed to load warranty claim data.') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Warranty claim assignee display names',
  methods: {
    GET: {
      summary: 'Resolve assignee user ids to display names',
      description: `Resolves up to ${MAX_ASSIGNEE_LOOKUP_IDS} explicitly supplied user ids to their display name, scoped to the caller's tenant and selected or visible organizations. Requires \`ids\`; it cannot enumerate the user directory, and it returns neither role assignments nor organization membership.`,
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Assignee display names',
          schema: responseSchema,
        },
      ],
    },
  },
}
