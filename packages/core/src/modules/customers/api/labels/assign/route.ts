import { NextResponse } from 'next/server'
import { CustomerLabel, CustomerLabelAssignment, CustomerEntity } from '../../../data/entities'
import { labelAssignmentSchema } from '../../../data/validators'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { z } from 'zod'
import { resolveLabelActorUserId } from '../auth'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import {
  createMissingCustomerLabelTablesError,
  isMissingCustomerLabelTable,
} from '../table-errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
}

const labelAssignmentRequestSchema = labelAssignmentSchema.extend({
  organizationId: z.string().uuid().optional(),
})

export async function POST(req: Request) {
  try {
    const { translate } = await resolveTranslations()
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const actorUserId = resolveLabelActorUserId(auth)
    if (!auth || !auth.tenantId || !actorUserId) {
      return NextResponse.json({ error: translate('customers.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }

    const body = labelAssignmentRequestSchema.parse(await readJsonSafe(req, {}))
    const scope = await resolveOrganizationScopeForRequest({
      container,
      auth,
      request: req,
      selectedId: body.organizationId ?? undefined,
    })
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
    }
    const em = (container.resolve('em') as EntityManager).fork()
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId,
      userId: actorUserId,
      resourceKind: 'customers.person',
      resourceId: body.entityId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: body,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const label = await findOneWithDecryption(em, CustomerLabel, {
      id: body.labelId,
      tenantId: auth.tenantId,
      organizationId,
      userId: actorUserId,
    }, {}, { tenantId: auth.tenantId, organizationId })
    if (!label) {
      throw new CrudHttpError(404, { error: translate('customers.errors.label_not_found', 'Label not found') })
    }

    const entity = await findOneWithDecryption(em, CustomerEntity, {
      id: body.entityId,
      tenantId: auth.tenantId,
      organizationId,
    }, {}, { tenantId: auth.tenantId, organizationId })
    if (!entity) {
      throw new CrudHttpError(404, { error: translate('customers.errors.entity_not_found', 'Entity not found') })
    }

    const existing = await findOneWithDecryption(em, CustomerLabelAssignment, {
      tenantId: auth.tenantId,
      organizationId,
      userId: actorUserId,
      label,
      entity,
    } as FilterQuery<CustomerLabelAssignment>, {}, { tenantId: auth.tenantId, organizationId })
    if (existing) {
      return NextResponse.json({ id: existing.id })
    }

    const assignment = em.create(CustomerLabelAssignment, {
      tenantId: auth.tenantId,
      organizationId,
      userId: actorUserId,
      label,
      entity,
    })
    em.persist(assignment)
    await em.flush()

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId,
        userId: actorUserId,
        resourceKind: 'customers.person',
        resourceId: body.entityId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({ id: assignment.id }, { status: 201 })
  } catch (err) {
    if (isMissingCustomerLabelTable(err)) {
      const migrationError = createMissingCustomerLabelTablesError()
      return NextResponse.json(migrationError.body, { status: migrationError.status })
    }
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[customers/labels/assign.POST]', err)
    return NextResponse.json({ error: 'Failed to assign label' }, { status: 500 })
  }
}

const responseSchema = z.object({ id: z.string().uuid() })
const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Assign label to entity',
  methods: {
    POST: {
      summary: 'Assign label',
      requestBody: { contentType: 'application/json', schema: labelAssignmentRequestSchema },
      responses: [
        { status: 201, description: 'Assigned', schema: responseSchema },
        { status: 200, description: 'Already assigned', schema: responseSchema },
      ],
      errors: [
        { status: 404, description: 'Label or entity not found', schema: errorSchema },
      ],
    },
  },
}
