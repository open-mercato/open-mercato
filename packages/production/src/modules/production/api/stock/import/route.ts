import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { parseCsvDocumentBatches } from '@open-mercato/core/modules/sync_excel/lib/parser'
import { resolveProductionActionContext } from '../../actionRouteContext.js'
import { STOCK_IMPORT_MAX_ROWS } from '../../../data/validators.js'
import {
  validateStockImportRow,
  assertWithinRowCap,
  buildStockImportSummary,
  StockImportRowCapExceededError,
} from '../../stockImportParser.js'
import { defaultOkResponseSchema } from '../../openapi.js'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['production.stock.manage'] },
}

const IMPORT_BATCH_SIZE = 200

/**
 * Streaming CSV stock import (task 2.2). Mirrors the `sync_excel` streaming
 * approach (`parseCsvDocumentBatches` — never buffers the whole file, yields
 * fixed-size row batches as they're decoded) rather than reading the whole
 * request body into memory first; the row cap (`STOCK_IMPORT_MAX_ROWS`) is
 * enforced incrementally as batches stream in.
 *
 * Cap-exceeded contract (review finding, task 2.2 follow-up): each batch of
 * `IMPORT_BATCH_SIZE` rows is received via its own `production.stock.receive`
 * command dispatch, so a batch that already ran BEFORE the cap trips has
 * real, committed movements — an operator can't be told "nothing happened"
 * once that's true. When the running row count crosses the cap, this route
 * stops processing further batches (rows in the batch that would have
 * crossed the cap are never dispatched) and returns 413 — chosen over a 200
 * response so the transport-level status still signals "this request was
 * too big" — but the body ALWAYS carries `{ imported, failed, capExceeded,
 * errors }`, i.e. the real partial-success counts, never a bare error. The
 * caller (see `page.tsx`'s `StockImportDialog`) renders that partial count
 * distinctly and tells the operator not to re-upload the same file (already
 *-imported rows would be received again, since receipts are not
 * idempotent/deduplicated by row).
 *
 * Each valid row goes through `commandBus.execute('production.stock.receive', ...)`
 * (sourceType `'import'`) exactly like the manual receipt route, so import
 * rows get the same command-bus audit trail and side-effect flush.
 */
export async function POST(req: NextRequest) {
  const { translate } = await resolveTranslations()
  const imported: string[] = []
  const failed: Array<{ row: number; error: string }> = []
  let capExceeded = false

  try {
    const { ctx } = await resolveProductionActionContext(req)
    if (!req.body) {
      return NextResponse.json({ error: translate('production.errors.stock_import_empty_body', 'Request body is empty') }, { status: 400 })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    let rowsSeen = 0

    batchLoop: for await (const batch of parseCsvDocumentBatches(readableStreamToAsyncIterable(req.body), { batchSize: IMPORT_BATCH_SIZE })) {
      rowsSeen += batch.rows.length
      try {
        assertWithinRowCap(rowsSeen, STOCK_IMPORT_MAX_ROWS)
      } catch (capErr) {
        if (capErr instanceof StockImportRowCapExceededError) {
          // Rows already imported/failed from PRIOR batches stay as-is; this
          // batch's rows are never dispatched.
          capExceeded = true
          break batchLoop
        }
        throw capErr
      }

      for (const [index, raw] of batch.rows.entries()) {
        const rowNumber = batch.rowStart + index + 1 // 1-indexed, header excluded
        const result = validateStockImportRow(raw, rowNumber)
        if (!result.ok) {
          failed.push({ row: result.rowNumber, error: result.error })
          continue
        }

        try {
          const { result: receiveResult } = await commandBus.execute<
            {
              productId: string
              variantId?: string | null
              qty: number
              uom: string
              batchNumber?: string | null
              expiresAt?: Date | null
              sourceType: 'import'
            },
            { movementIds: string[] }
          >('production.stock.receive', {
            input: {
              productId: result.row.product_id,
              variantId: result.row.variant_id ?? null,
              qty: result.row.qty,
              uom: result.row.uom,
              batchNumber: result.row.batch_number ?? null,
              expiresAt: result.row.expires_at ?? null,
              sourceType: 'import',
            },
            ctx,
          })
          imported.push(receiveResult.movementIds[0] ?? '')
        } catch (err) {
          // Commands already translate their own domain errors (see
          // `mapStockProviderError` in commands/stock.ts) — `err.body.error`
          // is safe, translated, user-facing copy, never a raw `[internal]`
          // message.
          const message = isCrudHttpError(err) ? String(err.body?.error ?? err.message) : (err as Error).message
          failed.push({ row: result.rowNumber, error: message })
        }
      }
    }
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.errors.stock_import_failed', 'Failed to import stock CSV.') },
      { status: 400 },
    )
  }

  const summary = buildStockImportSummary({ importedCount: imported.length, errors: failed, capExceeded })

  if (capExceeded) {
    return NextResponse.json(
      {
        ...summary,
        error: translate(
          'production.errors.import_row_cap',
          'The file exceeds the maximum of {maxRows} rows. {imported} rows were already imported before the limit was reached — do not re-upload the same file.',
          { maxRows: STOCK_IMPORT_MAX_ROWS, imported: summary.imported },
        ),
      },
      { status: 413 },
    )
  }

  return NextResponse.json(summary)
}

async function* readableStreamToAsyncIterable(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) yield value
    }
  } finally {
    reader.releaseLock()
  }
}

const importResponseSchema = z.object({
  imported: z.number(),
  failed: z.number(),
  capExceeded: z.boolean(),
  errors: z.array(z.object({ row: z.number(), error: z.string() })),
})

const importCapExceededResponseSchema = importResponseSchema.extend({
  capExceeded: z.literal(true),
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Import production stock from CSV',
  methods: {
    POST: {
      operationId: 'importProductionStock',
      summary: 'Stream-import stock receipts from a CSV file',
      description: `Streams a CSV body (columns: product_id, variant_id?, qty, uom, batch_number?, expires_at?), receiving each valid row via production.stock.receive. Above ${STOCK_IMPORT_MAX_ROWS} rows, returns 413 but the body still carries the PARTIAL {imported, failed} counts from batches that already ran before the cap tripped (capExceeded: true) — never a bare error with no counts.`,
      responses: [{ status: 200, description: 'Import result', schema: importResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        {
          status: 413,
          description: 'Row count exceeds the max import cap — body still carries the partial import summary',
          schema: importCapExceededResponseSchema,
        },
      ],
    },
  },
}

export { defaultOkResponseSchema }
