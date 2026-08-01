/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/core/generated/entities.ids.generated', () => ({
  E: {
    sales: {
      sales_order: 'sales:sales_order',
      sales_quote: 'sales:sales_quote',
    },
  },
}))

import { buildDocumentCrudOptions } from '../documents/factory'
import { SalesOrder, SalesQuote } from '../../data/entities'
import { E } from '#generated/entities.ids.generated'

describe('buildDocumentCrudOptions', () => {
  describe('buildFilters', () => {
    const orderBinding = {
      kind: 'order' as const,
      entity: SalesOrder,
      entityId: E.sales.sales_order,
      numberField: 'orderNumber' as const,
      createCommandId: 'sales.orders.create',
      updateCommandId: 'sales.orders.update',
      deleteCommandId: 'sales.orders.delete',
      manageFeature: 'sales.orders.manage',
      viewFeature: 'sales.orders.view',
    }

    const quoteBinding = {
      kind: 'quote' as const,
      entity: SalesQuote,
      entityId: E.sales.sales_quote,
      numberField: 'quoteNumber' as const,
      createCommandId: 'sales.quotes.create',
      updateCommandId: 'sales.quotes.update',
      deleteCommandId: 'sales.quotes.delete',
      manageFeature: 'sales.quotes.manage',
      viewFeature: 'sales.quotes.view',
    }

    it('should filter orders by order_number when search is provided', async () => {
      const options = buildDocumentCrudOptions(orderBinding)
      const filters = await options.list.buildFilters({ search: 'ORD-123' })

      expect(filters).toEqual({
        order_number: { $ilike: '%ORD-123%' },
      })
    })

    it('should filter quotes by quote_number when search is provided', async () => {
      const options = buildDocumentCrudOptions(quoteBinding)
      const filters = await options.list.buildFilters({ search: 'QUO-456' })

      expect(filters).toEqual({
        quote_number: { $ilike: '%QUO-456%' },
      })
    })

    it('should escape percent signs in search term', async () => {
      const options = buildDocumentCrudOptions(orderBinding)
      const filters = await options.list.buildFilters({ search: '50%' })

      expect(filters).toEqual({
        order_number: { $ilike: '%50\\%%' },
      })
    })

    it('should trim whitespace from search term', async () => {
      const options = buildDocumentCrudOptions(orderBinding)
      const filters = await options.list.buildFilters({ search: '  ORD-123  ' })

      expect(filters).toEqual({
        order_number: { $ilike: '%ORD-123%' },
      })
    })

    it('should not add filter when search is empty', async () => {
      const options = buildDocumentCrudOptions(orderBinding)
      const filters = await options.list.buildFilters({ search: '' })

      expect(filters).toEqual({})
    })

    it('should not add filter when search is whitespace only', async () => {
      const options = buildDocumentCrudOptions(orderBinding)
      const filters = await options.list.buildFilters({ search: '   ' })

      expect(filters).toEqual({})
    })
  })

  describe('enrichers', () => {
    const orderBinding = {
      kind: 'order' as const,
      entity: SalesOrder,
      entityId: E.sales.sales_order,
      numberField: 'orderNumber' as const,
      createCommandId: 'sales.orders.create',
      updateCommandId: 'sales.orders.update',
      deleteCommandId: 'sales.orders.delete',
      manageFeature: 'sales.orders.manage',
      viewFeature: 'sales.orders.view',
    }

    const quoteBinding = {
      kind: 'quote' as const,
      entity: SalesQuote,
      entityId: E.sales.sales_quote,
      numberField: 'quoteNumber' as const,
      createCommandId: 'sales.quotes.create',
      updateCommandId: 'sales.quotes.update',
      deleteCommandId: 'sales.quotes.delete',
      manageFeature: 'sales.quotes.manage',
      viewFeature: 'sales.quotes.view',
    }

    it('opts orders into the sales order enricher surface', () => {
      const options = buildDocumentCrudOptions(orderBinding)
      expect(options.enrichers).toEqual({ entityId: 'sales:sales_order' })
    })

    it('does not opt quotes into WMS order enrichers', () => {
      const options = buildDocumentCrudOptions(quoteBinding)
      expect(options.enrichers).toBeUndefined()
    })
  })

  describe('list projection (#2233)', () => {
    const orderBinding = {
      kind: 'order' as const,
      entity: SalesOrder,
      entityId: E.sales.sales_order,
      numberField: 'orderNumber' as const,
      createCommandId: 'sales.orders.create',
      updateCommandId: 'sales.orders.update',
      deleteCommandId: 'sales.orders.delete',
      manageFeature: 'sales.orders.manage',
      viewFeature: 'sales.orders.view',
    }

    const detailOnlySnapshotColumns = [
      'billing_address_snapshot',
      'shipping_address_snapshot',
      'shipping_method_snapshot',
      'payment_method_snapshot',
      'totals_snapshot',
      'metadata',
    ]

    const resolveFields = (query: Record<string, unknown>): string[] => {
      const options = buildDocumentCrudOptions(orderBinding)
      const fields = options.list.fields
      expect(typeof fields).toBe('function')
      return (fields as (q: any) => string[])(query)
    }

    it('drops large detail-only JSONB snapshot columns from grid listings', () => {
      const gridFields = resolveFields({})
      for (const column of detailOnlySnapshotColumns) {
        expect(gridFields).not.toContain(column)
      }
    })

    it('keeps customer_snapshot in grid listings (grid renders customer name/email)', () => {
      const gridFields = resolveFields({})
      expect(gridFields).toContain('customer_snapshot')
    })

    it('keeps the scalar columns the grid renders', () => {
      const gridFields = resolveFields({})
      for (const column of [
        'id',
        'order_number',
        'status',
        'channel_id',
        'currency_code',
        'line_item_count',
        'grand_total_net_amount',
        'grand_total_gross_amount',
        'placed_at',
        'created_at',
        'updated_at',
      ]) {
        expect(gridFields).toContain(column)
      }
    })

    it('returns the full projection (including detail-only snapshots) for single-document fetches', () => {
      const detailFields = resolveFields({ id: '11111111-1111-1111-1111-111111111111' })
      for (const column of detailOnlySnapshotColumns) {
        expect(detailFields).toContain(column)
      }
      expect(detailFields).toContain('customer_snapshot')
    })

    it('does not narrow the projection when filtering a grid by customerId (multiple rows)', () => {
      const gridFields = resolveFields({ customerId: '22222222-2222-2222-2222-222222222222' })
      for (const column of detailOnlySnapshotColumns) {
        expect(gridFields).not.toContain(column)
      }
    })
  })
})
