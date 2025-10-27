import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandExecuteResult } from '@open-mercato/shared/lib/commands/types'
import { CustomerDictionaryEntry } from '../../../../data/entities'
import { mapDictionaryKind, resolveDictionaryRouteContext } from '../../context'
import { invalidateDictionaryCache } from '../../cache'

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

export async function PATCH(req: Request, ctx: { params?: { kind?: string; id?: string } }) {
  try {
    const routeContext = await resolveDictionaryRouteContext(req)
    const { mappedKind } = mapDictionaryKind(ctx.params?.kind)
    const { id } = paramsSchema.parse({ id: ctx.params?.id })
    const payload = patchSchema.parse(await req.json().catch(() => ({})))
    const commandBus = routeContext.container.resolve<CommandBus>('commandBus')
    let commandResult: CommandExecuteResult<{ entryId: string; changed: boolean }>
    try {
      commandResult = (await commandBus.execute('customers.dictionaryEntries.update', {
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
          throw new CrudHttpError(409, { error: routeContext.translate('customers.config.dictionaries.errors.duplicate', 'An entry with this value already exists') })
        }
        if (err.status === 400) {
          throw new CrudHttpError(400, { error: routeContext.translate('customers.errors.lookup_failed', 'Failed to save dictionary entry') })
        }
      }
      throw err
    }
    const { result, logEntry } = commandResult

    const entry = await routeContext.em.fork().findOne(CustomerDictionaryEntry, id)
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
    const { mappedKind } = mapDictionaryKind(ctx.params?.kind)
    const { id } = paramsSchema.parse({ id: ctx.params?.id })
    const commandBus = routeContext.container.resolve<CommandBus>('commandBus')
    let deleteResult: CommandExecuteResult<{ entryId: string }>
    try {
      deleteResult = (await commandBus.execute('customers.dictionaryEntries.delete', {
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
