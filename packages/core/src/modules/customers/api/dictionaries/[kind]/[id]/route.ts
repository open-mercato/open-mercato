import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandExecuteResult } from '@open-mercato/shared/lib/commands/types'
import { CustomerDictionaryEntry } from '../../../../data/entities'
import { mapDictionaryKind, resolveDictionaryActorId, resolveDictionaryRouteContext } from '../../context'
import { invalidateDictionaryCache } from '../../cache'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const patchSchema = z
  .object({
    value: z.string().trim().min(1).max(150).optional(),
    label: z.string().trim().max(150).optional(),
    color: z.union([z.string().trim(), z.null()]).optional(),
    icon: z.union([z.string().trim(), z.null()]).optional(),
  })
  .refine((input) => input.value !== undefined || input.label !== undefined || input.color !== undefined || input.icon !== undefined, {
    message: 'No changes provided',
  })

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['customers.settings.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.settings.manage'] },
}

function formatCountMessage(template: string, count: number) {
  return template.replace('{{count}}', String(count))
}

export async function PATCH(req: Request, ctx: { params?: { kind?: string; id?: string } }) {
  try {
    const routeContext = await resolveDictionaryRouteContext(req)
    if (!routeContext.organizationId) {
      throw new CrudHttpError(400, { error: routeContext.translate('customers.errors.organization_required', 'Organization context is required') })
    }
    const { mappedKind } = mapDictionaryKind(ctx.params?.kind)
    const { id } = paramsSchema.parse({ id: ctx.params?.id })
    const payload = patchSchema.parse(await readJsonSafe(req, {}))
    const guardUserId = resolveDictionaryActorId(routeContext.auth)
    const guardResult = await validateCrudMutationGuard(routeContext.container, {
      tenantId: routeContext.tenantId,
      organizationId: routeContext.organizationId,
      userId: guardUserId,
      resourceKind: 'customers.dictionary_entry',
      resourceId: id,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: payload,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }
    const commandBus = (routeContext.container.resolve('commandBus') as CommandBus)
    let commandResult: CommandExecuteResult<{ entryId: string; changed: boolean }>
    try {
      commandResult = (await commandBus.execute('customers.dictionary-entry.update', {
        input: {
          id,
          tenantId: routeContext.tenantId,
          organizationId: routeContext.organizationId,
          kind: mappedKind,
          value: payload.value,
          label: payload.label,
          color: payload.color,
          icon: payload.icon,
        },
        ctx: routeContext.ctx,
      })) as CommandExecuteResult<{ entryId: string; changed: boolean }>
    } catch (err) {
      if (err instanceof CrudHttpError) {
        if (err.status === 404) {
          throw new CrudHttpError(404, { error: routeContext.translate('customers.errors.lookup_failed', 'Dictionary entry not found') })
        }
        if (err.status === 409) {
          if ((err.body as Record<string, unknown> | undefined)?.code === 'role_type_in_use') {
            const usageCount = Number((err.body as Record<string, unknown> | undefined)?.usageCount ?? 0)
            throw new CrudHttpError(409, {
              ...(err.body as Record<string, unknown> | undefined),
              error: formatCountMessage(
                routeContext.translate(
                  'customers.config.dictionaries.errors.roleTypeValueInUse',
                  'This role type is assigned to {{count}} records. Remove or replace those assignments before changing its value.',
                ),
                usageCount,
              ),
            })
          }
          throw new CrudHttpError(409, { error: routeContext.translate('customers.config.dictionaries.errors.duplicate', 'An entry with this value already exists') })
        }
        if (err.status === 400) {
          throw new CrudHttpError(400, { error: routeContext.translate('customers.errors.lookup_failed', 'Failed to save dictionary entry') })
        }
      }
      throw err
    }
    const { result, logEntry } = commandResult

    const entry = await findOneWithDecryption(
      routeContext.em.fork(),
      CustomerDictionaryEntry,
      { id },
      {},
      {
        tenantId: routeContext.tenantId,
        organizationId: routeContext.organizationId,
      },
    )
    if (!entry) {
      throw new CrudHttpError(404, { error: routeContext.translate('customers.errors.lookup_failed', 'Dictionary entry not found') })
    }

    if (result.changed) {
      await invalidateDictionaryCache(routeContext.cache, {
        tenantId: routeContext.tenantId,
        mappedKind,
        organizationIds: [routeContext.organizationId],
      })
    }

    const response = NextResponse.json({
      id: entry.id,
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
      organizationId: entry.organizationId,
      isInherited: false,
    })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.dictionary_entry',
          resourceId: entry.id,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        })
      )
    }
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(routeContext.container, {
        tenantId: routeContext.tenantId,
        organizationId: routeContext.organizationId,
        userId: guardUserId,
        resourceKind: 'customers.dictionary_entry',
        resourceId: entry.id,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.dictionaries.update failed', err)
    return NextResponse.json({ error: translate('customers.errors.lookup_failed', 'Failed to save dictionary entry') }, { status: 400 })
  }
}

export async function DELETE(req: Request, ctx: { params?: { kind?: string; id?: string } }) {
  try {
    const routeContext = await resolveDictionaryRouteContext(req)
    if (!routeContext.organizationId) {
      throw new CrudHttpError(400, { error: routeContext.translate('customers.errors.organization_required', 'Organization context is required') })
    }
    const { mappedKind } = mapDictionaryKind(ctx.params?.kind)
    const { id } = paramsSchema.parse({ id: ctx.params?.id })
    const guardUserId = resolveDictionaryActorId(routeContext.auth)
    const guardResult = await validateCrudMutationGuard(routeContext.container, {
      tenantId: routeContext.tenantId,
      organizationId: routeContext.organizationId,
      userId: guardUserId,
      resourceKind: 'customers.dictionary_entry',
      resourceId: id,
      operation: 'delete',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: null,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }
    const commandBus = (routeContext.container.resolve('commandBus') as CommandBus)
    let deleteResult: CommandExecuteResult<{ entryId: string }>
    try {
      deleteResult = (await commandBus.execute('customers.dictionary-entry.delete', {
        input: {
          id,
          tenantId: routeContext.tenantId,
          organizationId: routeContext.organizationId,
          kind: mappedKind,
        },
        ctx: routeContext.ctx,
      })) as CommandExecuteResult<{ entryId: string }>
    } catch (err) {
      if (err instanceof CrudHttpError && err.status === 404) {
        throw new CrudHttpError(404, { error: routeContext.translate('customers.errors.lookup_failed', 'Dictionary entry not found') })
      }
      if (err instanceof CrudHttpError && err.status === 409 && (err.body as Record<string, unknown> | undefined)?.code === 'role_type_in_use') {
        const usageCount = Number((err.body as Record<string, unknown> | undefined)?.usageCount ?? 0)
        throw new CrudHttpError(409, {
          ...(err.body as Record<string, unknown> | undefined),
          error: formatCountMessage(
            routeContext.translate(
              'customers.config.dictionaries.errors.roleTypeDeleteInUse',
              'This role type is assigned to {{count}} records. Remove or replace those assignments before deleting it.',
            ),
            usageCount,
          ),
        })
      }
      throw err
    }
    const { logEntry } = deleteResult

    await invalidateDictionaryCache(routeContext.cache, {
      tenantId: routeContext.tenantId,
      mappedKind,
      organizationIds: [routeContext.organizationId],
    })

    const response = NextResponse.json({ success: true })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.dictionary_entry',
          resourceId: id,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        })
      )
    }
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(routeContext.container, {
        tenantId: routeContext.tenantId,
        organizationId: routeContext.organizationId,
        userId: guardUserId,
        resourceKind: 'customers.dictionary_entry',
        resourceId: id,
        operation: 'delete',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.dictionaries.delete failed', err)
    return NextResponse.json({ error: translate('customers.errors.lookup_failed', 'Failed to delete dictionary entry') }, { status: 400 })
  }
}

const dictionaryEntrySchema = z.object({
  id: z.string().uuid(),
  value: z.string(),
  label: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  isInherited: z.boolean().optional(),
})

const dictionaryDeleteResponseSchema = z.object({
  success: z.literal(true),
})

const dictionaryErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Customer dictionary entry',
  methods: {
    PATCH: {
      summary: 'Update dictionary entry',
      description: 'Updates value, label, color, or icon for an existing customer dictionary entry.',
      requestBody: {
        contentType: 'application/json',
        schema: patchSchema,
      },
      responses: [
        { status: 200, description: 'Updated dictionary entry', schema: dictionaryEntrySchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: dictionaryErrorSchema },
        { status: 401, description: 'Unauthorized', schema: dictionaryErrorSchema },
        { status: 404, description: 'Entry not found', schema: dictionaryErrorSchema },
        { status: 409, description: 'Duplicate value conflict', schema: dictionaryErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete dictionary entry',
      description: 'Removes a customer dictionary entry by identifier.',
      responses: [
        { status: 200, description: 'Entry deleted', schema: dictionaryDeleteResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: dictionaryErrorSchema },
        { status: 404, description: 'Entry not found', schema: dictionaryErrorSchema },
        { status: 409, description: 'Entry is in use and cannot be deleted', schema: dictionaryErrorSchema },
      ],
    },
  },
}
