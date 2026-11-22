import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError, CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createOrderSchema, customerSnapshotSchema } from '../../../data/validators'
import { resolveFreightActionContext } from '../../../lib/apiAction'
import { FREIGHT_ORDER_ENTITY_ID } from '../../../commands/entities'

export const metadata = {
  path: '/freight_operations/orders/import',
  POST: { requireAuth: true, requireFeatures: ['freight.orders.manage'] },
}

const logger = createLogger('freight_operations')

const importRowSchema = z.object({
  rowNumber: z.number().int().min(1),
  payload: z.record(z.string(), z.unknown()),
})

const importBodySchema = z.object({
  customerId: z.string().uuid(),
  customerSnapshot: customerSnapshotSchema,
  mode: z.enum(['dry-run', 'commit']),
  rows: z.array(importRowSchema).min(1).max(500),
})

export type OrderImportRowReport = {
  rowNumber: number
  status: 'valid' | 'invalid' | 'created' | 'failed'
  errors: string[]
}

/**
 * Bulk spot-order import with the same dry-run/commit contract as the contract
 * rate importer. The customer is chosen once for the whole batch; every row is
 * validated with the single-order schema, so the preview and the committed
 * rows cannot disagree about what a valid order is.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const context = await resolveFreightActionContext(req)
    const raw = await readJsonSafe(req, {})
    const body = importBodySchema.parse({ ...(raw as Record<string, unknown>) })
    const userId = context.ctx.auth?.sub
    if (!userId) throw new CrudHttpError(401, { error: context.translate('errors.unauthorized', 'Unauthorized') })

    const guarded = await runRouteMutationGuards({
      container: context.ctx.container,
      req,
      auth: { userId, tenantId: context.tenantId, organizationId: context.organizationId },
      input: {
        resourceKind: FREIGHT_ORDER_ENTITY_ID,
        resourceId: `import:${body.customerId}`,
        operation: 'create',
        mutationPayload: { mode: body.mode, customerId: body.customerId, rowCount: body.rows.length },
      },
    })
    if (!guarded.ok) return guarded.response

    const reports: OrderImportRowReport[] = []
    const validRows: Array<{ rowNumber: number; input: Record<string, unknown> }> = []
    for (const row of body.rows) {
      const parsed = createOrderSchema.safeParse({
        customerId: body.customerId,
        customerSnapshot: body.customerSnapshot,
        ...row.payload,
      })
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
      if (parsed.success) validRows.push({ rowNumber: row.rowNumber, input: parsed.data as Record<string, unknown> })
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
        await commandBus.execute('freight_operations.orders.create', { input: row.input, ctx: context.ctx })
        created += 1
        if (report) report.status = 'created'
      } catch (error) {
        if (report) {
          report.status = 'failed'
          report.errors = [isCrudHttpError(error)
            ? String((error.body as { error?: string }).error ?? 'The order could not be created.')
            : 'The order could not be created.']
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
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    }
    logger.error('freight_operations.order_import.failed', { err })
    return NextResponse.json({ error: 'Unable to import the orders.' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Import spot orders from a spreadsheet',
  methods: {
    POST: {
      summary: 'Validate (dry-run) or commit a batch of spot orders for one customer',
      requestBody: { contentType: 'application/json', schema: importBodySchema },
      responses: [
        {
          status: 200,
          description: 'Per-row validation or creation report',
          schema: z.object({
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
          }),
        },
      ],
    },
  },
}
