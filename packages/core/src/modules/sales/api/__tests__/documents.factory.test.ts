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
      createCommandId: 'sales.order.create',
      updateCommandId: 'sales.order.update',
      deleteCommandId: 'sales.order.delete',
      manageFeature: 'sales.order.manage',
      viewFeature: 'sales.order.view',
    }

    const quoteBinding = {
      kind: 'quote' as const,
      entity: SalesQuote,
      entityId: E.sales.sales_quote,
      numberField: 'quoteNumber' as const,
      createCommandId: 'sales.quote.create',
      updateCommandId: 'sales.quote.update',
      deleteCommandId: 'sales.quote.delete',
      manageFeature: 'sales.quote.manage',
      viewFeature: 'sales.quote.view',
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
})
