import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveTransportActionContext } from './routeContext'

/**
 * Bulk import runner for drivers and vehicles.
 *
 * The dialog parses a sheet into rows, this route re-validates every row with
 * the entity's own create schema, and only a clean row reaches the command bus.
 * Dry-run and commit share the validation path, so the preview cannot promise
 * something the commit would reject. A row that races against a uniqueness
 * index still fails on its own without aborting the rest of the batch.
 */

const logger = createLogger('transport_operations')

export const importRowSchema = z.object({
  rowNumber: z.number().int().min(1),
  payload: z.record(z.string(), z.unknown()),
})

export const importBodySchema = z.object({
  mode: z.enum(['dry-run', 'commit']),
  rows: z.array(importRowSchema).min(1).max(500),
})

export type ImportRowReport = {
  rowNumber: number
  status: 'valid' | 'invalid' | 'created' | 'failed'
  errors: string[]
}

export const importResponseSchema = z.object({
  ok: z.boolean(),
  mode: z.enum(['dry-run', 'commit']),
  summary: z.object({
    total: z.number(),
    valid: z.number().optional(),
    invalid: z.number(),
    created: z.number().optional(),
    failed: z.number().optional(),
  }),
  rows: z.array(z.object({
    rowNumber: z.number(),
    status: z.enum(['valid', 'invalid', 'created', 'failed']),
    errors: z.array(z.string()),
  })),
})

export type TransportImportConfig = {
  resourceKind: string
  resourceId: string
  commandId: string
  schema: z.ZodType
  failureKey: string
  failureFallback: string
  logEvent: string
}

export async function runTransportImport(req: Request, config: TransportImportConfig): Promise<Response> {
  try {
    const context = await resolveTransportActionContext(req)
    const raw = await readJsonSafe(req, {})
    const body = importBodySchema.parse(raw ?? {})

    const guarded = await runRouteMutationGuards({
      container: context.ctx.container,
      req,
      auth: { userId: context.userId, tenantId: context.tenantId, organizationId: context.organizationId },
      input: {
        resourceKind: config.resourceKind,
        resourceId: config.resourceId,
        operation: 'create',
        mutationPayload: { mode: body.mode, rowCount: body.rows.length },
      },
    })
    if (!guarded.ok) return guarded.response

    const reports: ImportRowReport[] = []
    const validRows: Array<{ rowNumber: number; input: Record<string, unknown> }> = []
    for (const row of body.rows) {
      const parsed = config.schema.safeParse(row.payload)
      const errors: string[] = []
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const path = issue.path.filter((part) => part !== undefined).join('.')
          errors.push(path ? `${path}: ${issue.message}` : issue.message)
        }
      }
      if (errors.length) {
        reports.push({ rowNumber: row.rowNumber, status: 'invalid', errors })
        continue
      }
      reports.push({ rowNumber: row.rowNumber, status: 'valid', errors: [] })
      validRows.push({ rowNumber: row.rowNumber, input: parsed.data as Record<string, unknown> })
    }

    const validCount = reports.filter((report) => report.status === 'valid').length
    if (body.mode === 'dry-run') {
      await guarded.runAfterSuccess()
      return NextResponse.json({
        ok: true,
        mode: 'dry-run',
        summary: { total: reports.length, valid: validCount, invalid: reports.length - validCount },
        rows: reports,
      })
    }

    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    let created = 0
    for (const row of validRows) {
      const report = reports.find((entry) => entry.rowNumber === row.rowNumber)
      try {
        await commandBus.execute(config.commandId, { input: row.input, ctx: context.ctx })
        created += 1
        if (report) report.status = 'created'
      } catch (error) {
        if (report) {
          report.status = 'failed'
          report.errors = [isCrudHttpError(error)
            ? String((error.body as { error?: string }).error ?? context.translate(config.failureKey, config.failureFallback))
            : context.translate(config.failureKey, config.failureFallback)]
        }
      }
    }

    await guarded.runAfterSuccess()
    return NextResponse.json({
      ok: true,
      mode: 'commit',
      summary: {
        total: reports.length,
        invalid: reports.length - validCount,
        created,
        failed: validCount - created,
      },
      rows: reports,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('errors.invalid_input', 'Invalid input'), details: err.issues }, { status: 400 })
    }
    logger.error(config.logEvent, { err })
    return NextResponse.json(
      { error: translate('transport_operations.import.error.failed', 'The import could not be completed.') },
      { status: 400 },
    )
  }
}
