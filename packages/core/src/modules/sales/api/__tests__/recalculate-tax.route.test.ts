/** @jest-environment node */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { recalculateDocumentTaxSchema } from '../../data/validators'

const routeSource = readFileSync(
  join(__dirname, '..', 'documents', 'recalculate-tax', 'route.ts'),
  'utf8'
)
const commandSource = readFileSync(join(__dirname, '..', '..', 'commands', 'documents.ts'), 'utf8')

const validId = '11111111-1111-4111-8111-111111111111'

describe('recalculateDocumentTaxSchema', () => {
  it('accepts an order and a quote', () => {
    expect(
      recalculateDocumentTaxSchema.safeParse({ documentId: validId, documentKind: 'order' }).success
    ).toBe(true)
    expect(
      recalculateDocumentTaxSchema.safeParse({ documentId: validId, documentKind: 'quote' }).success
    ).toBe(true)
  })

  it('rejects invoices and credit memos, which inherit rather than recalculate', () => {
    expect(
      recalculateDocumentTaxSchema.safeParse({ documentId: validId, documentKind: 'invoice' }).success
    ).toBe(false)
    expect(
      recalculateDocumentTaxSchema.safeParse({ documentId: validId, documentKind: 'credit_memo' })
        .success
    ).toBe(false)
  })

  it('rejects a non-uuid document id', () => {
    expect(
      recalculateDocumentTaxSchema.safeParse({ documentId: 'not-a-uuid', documentKind: 'order' })
        .success
    ).toBe(false)
  })
})

describe('recalculate-tax route', () => {
  it('requires both manage features, so the kind cannot be flipped to escalate', () => {
    expect(routeSource).toContain(
      "requireFeatures: ['sales.orders.manage', 'sales.quotes.manage']"
    )
    expect(routeSource).toContain('requireAuth: true')
  })

  it('runs the mutation guards as an update before executing', () => {
    expect(routeSource).toContain('runMutationGuards')
    expect(routeSource).toContain('bridgeLegacyGuard')
    expect(routeSource).toContain("operation: 'update',")
    expect(routeSource.indexOf('runGuards(ctx')).toBeLessThan(
      routeSource.indexOf("commandBus.execute")
    )
  })

  it('maps the resource kind from the requested document kind', () => {
    expect(routeSource).toContain(
      "const resourceKind = input.documentKind === 'order' ? 'sales.order' : 'sales.quote'"
    )
  })

  it('scopes the payload and exports openApi', () => {
    expect(routeSource).toContain('withScopedPayload')
    expect(routeSource).toContain('export const openApi')
    expect(routeSource).toContain("'sales.documents.recalculate_tax'")
  })

  it('returns the resulting status so the caller can clear its banner', () => {
    expect(routeSource).toContain('taxStatus: result?.taxStatus ?? null,')
    expect(routeSource).toContain('taxCalculatedAt: result?.taxCalculatedAt ?? null,')
  })

  it('emits the undo operation header like every other sales write', () => {
    expect(routeSource).toContain('serializeOperationMetadata')
    expect(routeSource).toContain("jsonResponse.headers.set(\n        'x-om-operation',")
  })
})

describe('sales.documents.recalculate_tax command', () => {
  const command = commandSource.slice(
    commandSource.indexOf('const recalculateDocumentTaxCommand'),
    commandSource.indexOf('registerCommand(updateQuoteCommand);')
  )

  it('enforces the document optimistic lock for both kinds', () => {
    const locks = command.match(/enforceSalesDocumentOptimisticLock/g) ?? []
    expect(locks.length).toBe(2)
  })

  it('enforces the organization scope for both kinds', () => {
    expect(command).toContain('ensureOrderScope(ctx, order.organizationId, order.tenantId)')
    expect(command).toContain('ensureQuoteScope(ctx, quote.organizationId, quote.tenantId)')
  })

  it('writes totals and provenance inside one transaction', () => {
    const atomic = command.match(/withAtomicFlush\(/g) ?? []
    expect(atomic.length).toBe(2)
    expect(command).toContain('{ transaction: true }')
    expect(command).toContain('applyTaxColumns(order, calculation)')
    expect(command).toContain('applyTaxColumns(quote, calculation)')
  })

  it('changes no line or header field', () => {
    // The only writes are the totals, the tax columns and updatedAt.
    expect(command).not.toContain('replaceOrderLines')
    expect(command).not.toContain('replaceQuoteLines')
    expect(command).not.toContain('replaceOrderAdjustments')
    expect(command).not.toContain('replaceQuoteAdjustments')
  })

  it('restores the stored graph on undo without calling a provider', () => {
    expect(command).toContain('restoreOrderGraph(em, before)')
    expect(command).toContain('restoreQuoteGraph(em, before.quote)')
    // The previous tax result is already in the snapshot; re-running the vendor
    // would be a second billable call that could return a third answer.
    const undoHandler = command.slice(command.indexOf('  undo: async ('))
    expect(undoHandler).not.toContain('calculateDocumentTotals')
    expect(undoHandler).not.toContain('resolveDocumentCalculationContext')
  })

  it('preserves the recorded payment totals on an order recalculation', () => {
    expect(command).toContain('existingTotals: resolveExistingPaymentTotals(order)')
  })
})
