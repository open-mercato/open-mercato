import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError, CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { FreightContract, FreightContractRoute } from '../../../data/entities'
import { createContractRouteSchema } from '../../../data/validators'
import { resolveFreightActionContext } from '../../../lib/apiAction'
import { FREIGHT_CONTRACT_ENTITY_ID } from '../../../commands/entities'

export const metadata = {
  path: '/freight_operations/contract-routes/import',
  POST: { requireAuth: true, requireFeatures: ['freight.contracts.manage'] },
}

const logger = createLogger('freight_operations')

const importRowSchema = z.object({
  rowNumber: z.number().int().min(1),
  payload: z.record(z.string(), z.unknown()),
})

const importBodySchema = z.object({
  contractId: z.string().uuid(),
  mode: z.enum(['dry-run', 'commit']),
  rows: z.array(importRowSchema).min(1).max(500),
})

export type RateImportRowReport = {
  rowNumber: number
  status: 'valid' | 'invalid' | 'created' | 'failed'
  errors: string[]
}

/**
 * Bulk rate-line import with a dry run.
 *
 * The dry run validates every row against the same schema the single-row route
 * uses *and* against the contract's current line numbers, so the preview the
 * operator approves is the set that will be written — the commit repeats the
 * same validation and refuses anything that changed in between rather than
 * writing a partial result quietly.
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
        resourceKind: FREIGHT_CONTRACT_ENTITY_ID,
        resourceId: body.contractId,
        operation: 'update',
        mutationPayload: body,
      },
    })
    if (!guarded.ok) return guarded.response

    const em = (context.ctx.container.resolve('em') as EntityManager).fork()
    const contract = await em.findOne(FreightContract, {
      id: body.contractId,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      deletedAt: null,
    })
    if (!contract) {
      throw new CrudHttpError(404, {
        error: context.translate('freight_operations.errors.contract_not_found', 'Freight contract not found.'),
      })
    }
    if (contract.status !== 'draft' && contract.status !== 'active') {
      throw new CrudHttpError(409, {
        error: context.translate('freight_operations.errors.contract_not_writable', 'A terminated contract cannot be changed.'),
      })
    }

    const existing = await em.find(FreightContractRoute, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      contract: contract.id,
      deletedAt: null,
    })
    const takenLineNumbers = new Set(existing.map((line) => line.lineNumber))

    const reports: RateImportRowReport[] = []
    const validRows: Array<{ rowNumber: number; input: Record<string, unknown> }> = []
    for (const row of body.rows) {
      const parsed = createContractRouteSchema.safeParse({ contractId: body.contractId, ...row.payload })
      const errors: string[] = []
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const path = issue.path.filter((part) => part !== undefined).join('.')
          errors.push(path ? `${path}: ${issue.message}` : issue.message)
        }
      } else {
        const lineNumber = parsed.data.lineNumber
        if (lineNumber !== undefined && lineNumber !== null) {
          if (takenLineNumbers.has(Number(lineNumber))) {
            errors.push(`lineNumber: ${lineNumber} is already used on this contract`)
          } else {
            // Claim it immediately so two rows of the same file cannot both take it.
            takenLineNumbers.add(Number(lineNumber))
          }
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

    // Sequential on purpose: an absent line number is allocated as max+1 inside
    // the create command, so parallel writes would race for the same number.
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    let created = 0
    for (const row of validRows) {
      const report = reports.find((entry) => entry.rowNumber === row.rowNumber)
      try {
        await commandBus.execute('freight_operations.contract-routes.create', { input: row.input, ctx: context.ctx })
        created += 1
        if (report) report.status = 'created'
      } catch (error) {
        if (report) {
          report.status = 'failed'
          report.errors = [isCrudHttpError(error)
            ? String((error.body as { error?: string }).error ?? 'The rate line could not be created.')
            : 'The rate line could not be created.']
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
      return NextResponse.json(
        { error: 'Invalid input', details: err.issues },
        { status: 400 },
      )
    }
    logger.error('freight_operations.rate_import.failed', { err })
    return NextResponse.json({ error: 'Unable to import the rate lines.' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Import contract rate lines from a spreadsheet',
  methods: {
    POST: {
      summary: 'Validate (dry-run) or commit a batch of rate lines for a contract',
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
