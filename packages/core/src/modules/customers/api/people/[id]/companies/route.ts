import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import {
  addPersonCompanyLink,
  loadPersonCompanyLinks,
  summarizePersonCompanies,
} from '@open-mercato/core/modules/customers/lib/personCompanies'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveAuthActorId } from '@open-mercato/core/modules/customers/lib/interactionRequestContext'
import { loadPersonContext } from './context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const createSchema = z.object({
  companyId: z.string().uuid(),
  isPrimary: z.boolean().optional(),
})

const listResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      companyId: z.string().uuid(),
      displayName: z.string(),
      isPrimary: z.boolean(),
    }),
  ),
})

const createResponseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    displayName: z.string(),
    isPrimary: z.boolean(),
  }),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  methods: {
    GET: {
      summary: 'List linked companies for a person',
      responses: [{ status: 200, description: 'Linked company rows', schema: listResponseSchema }],
    },
    POST: {
      summary: 'Link a company to a person',
      requestBody: { schema: createSchema },
      responses: [{ status: 200, description: 'Linked company row', schema: createResponseSchema }],
    },
  },
}

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { id } = paramsSchema.parse({ id: ctx.params?.id })
    const { em, person, profile } = await loadPersonContext(req, id)
    const links = await loadPersonCompanyLinks(em, person)
    const items = summarizePersonCompanies(profile, links).map((entry) => ({
      id: entry.linkId ?? entry.companyId,
      companyId: entry.companyId,
      displayName: entry.displayName,
      isPrimary: entry.isPrimary,
    }))
    return NextResponse.json({ items })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: translate('customers.errors.internal', 'Internal server error') }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: { params?: { id?: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { id } = paramsSchema.parse({ id: ctx.params?.id })
    const payload = createSchema.parse(await readJsonSafe(req, {}))
    const { container, auth, selectedOrganizationId, em, person, profile } = await loadPersonContext(req, id)
    const guardUserId = resolveAuthActorId(auth)
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId: selectedOrganizationId,
      userId: guardUserId,
      resourceKind: 'customers.person',
      resourceId: person.id,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: payload,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }
    const link = await addPersonCompanyLink(em, person, profile, payload.companyId, {
      isPrimary: payload.isPrimary,
    })
    await em.flush()
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: selectedOrganizationId,
        userId: guardUserId,
        resourceKind: 'customers.person',
        resourceId: person.id,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    const company = typeof link.company === 'string' ? null : link.company
    return NextResponse.json({
      ok: true,
      result: {
        id: link.id,
        companyId: company?.id ?? payload.companyId,
        displayName: company?.displayName ?? '',
        isPrimary: Boolean(link.isPrimary),
      },
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: translate('customers.errors.internal', 'Internal server error') }, { status: 500 })
  }
}
