import { NextResponse } from 'next/server'
import { CustomerEntity } from '../../../data/entities'
import { labelAssignCommandSchema, labelAssignmentSchema, type LabelAssignCommandInput } from '../../../data/validators'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
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
  POST: { requireAuth: true },
}

const labelAssignmentRequestSchema = labelAssignmentSchema.extend({
  organizationId: z.string().uuid().optional(),
})

function resolveResourceKind(kind: 'person' | 'company' | null | undefined): string {
  if (kind === 'company') return 'customers.company'
  return 'customers.person'
}

function resolveRequiredFeature(kind: 'person' | 'company' | null | undefined): string {
  return kind === 'company' ? 'customers.companies.manage' : 'customers.people.manage'
}

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
    const targetEntity = await findOneWithDecryption(
      em,
      CustomerEntity,
      {
        id: body.entityId,
        tenantId: auth.tenantId,
        organizationId,
        deletedAt: null,
      },
      undefined,
      { tenantId: auth.tenantId, organizationId },
    )
    if (!targetEntity) {
      throw new CrudHttpError(404, { error: translate('customers.errors.entity_not_found', 'Entity not found') })
    }
    const entityKind = targetEntity.kind === 'person' || targetEntity.kind === 'company' ? targetEntity.kind : null
    const resourceKind = resolveResourceKind(entityKind)

    const rbac = container.resolve('rbacService') as RbacService | undefined
    if (!rbac) {
      throw new CrudHttpError(500, { error: translate('customers.errors.internal', 'Internal error') })
    }
    const requiredFeature = resolveRequiredFeature(entityKind)
    const hasFeature = await rbac.userHasAllFeatures(actorUserId, [requiredFeature], {
      tenantId: auth.tenantId,
      organizationId,
    })
    if (!hasFeature) {
      throw new CrudHttpError(403, { error: translate('customers.errors.access_denied', 'Access denied') })
    }

    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId,
      userId: actorUserId,
      resourceKind,
      resourceId: body.entityId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: body,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandInput = labelAssignCommandSchema.parse({
      labelId: body.labelId,
      entityId: body.entityId,
      tenantId: auth.tenantId,
      organizationId,
    } satisfies LabelAssignCommandInput)

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<LabelAssignCommandInput, { assignmentId: string; created: boolean; entityKind: 'person' | 'company' | null }>(
      'customers.labels.assign',
      {
        input: commandInput,
        ctx: {
          container,
          auth,
          organizationScope: scope,
          selectedOrganizationId: organizationId,
          organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
          request: req,
        },
      },
    )

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId,
        userId: actorUserId,
        resourceKind,
        resourceId: body.entityId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    const response = NextResponse.json({ id: result.assignmentId }, { status: result.created ? 201 : 200 })
    if (result.created && logEntry?.undoToken && logEntry.id && logEntry.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.labelAssignment',
          resourceId: logEntry.resourceId ?? result.assignmentId,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : new Date().toISOString(),
        }),
      )
    }
    return response
  } catch (err) {
    if (isMissingCustomerLabelTable(err)) {
      const migrationError = await createMissingCustomerLabelTablesError()
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
