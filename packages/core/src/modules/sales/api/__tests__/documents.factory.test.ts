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

const mockRecalculateOrderTotalsForDisplay = jest.fn()

jest.mock('../../commands/returns', () => ({
  recalculateOrderTotalsForDisplay: (...args: unknown[]) => mockRecalculateOrderTotalsForDisplay(...args),
}))

import { MAX_IDS_PER_REQUEST } from '@open-mercato/shared/lib/crud/ids'
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

    describe('channel filtering', () => {
      const channelA = '11111111-1111-4111-8111-111111111111'
      const channelB = '22222222-2222-4222-9222-222222222222'

      it('should filter by a single channel with $eq', async () => {
        const options = buildDocumentCrudOptions(orderBinding)
        const filters = await options.list.buildFilters({ channelId: channelA })

        expect(filters).toEqual({ channel_id: { $eq: channelA } })
      })

      it('should filter by several channels with $in', async () => {
        const options = buildDocumentCrudOptions(orderBinding)
        const filters = await options.list.buildFilters({ channelIds: `${channelA},${channelB}` })

        expect(filters).toEqual({ channel_id: { $in: [channelA, channelB] } })
      })

      it('should trim and dedupe channelIds entries', async () => {
        const options = buildDocumentCrudOptions(orderBinding)
        const filters = await options.list.buildFilters({ channelIds: ` ${channelA} , ${channelB},${channelA} ` })

        expect(filters).toEqual({ channel_id: { $in: [channelA, channelB] } })
      })

      it('should let the singular channelId win over channelIds', async () => {
        const options = buildDocumentCrudOptions(orderBinding)
        const filters = await options.list.buildFilters({
          channelId: channelA,
          channelIds: `${channelB}`,
        })

        expect(filters).toEqual({ channel_id: { $eq: channelA } })
      })

      it('should let the singular channelId win over channelIdsEmpty', async () => {
        const options = buildDocumentCrudOptions(orderBinding)
        const filters = await options.list.buildFilters({
          channelId: channelA,
          channelIdsEmpty: 'true',
        })

        expect(filters).toEqual({ channel_id: { $eq: channelA } })
      })

      it('should match unassigned documents when channelIdsEmpty is set', async () => {
        const options = buildDocumentCrudOptions(orderBinding)
        const filters = await options.list.buildFilters({ channelIdsEmpty: 'true' })

        expect(filters).toEqual({ channel_id: { $exists: false } })
      })

      it('should combine channelIds and channelIdsEmpty instead of dropping one', async () => {
        const options = buildDocumentCrudOptions(orderBinding)
        const filters = await options.list.buildFilters({
          channelIds: `${channelA},${channelB}`,
          channelIdsEmpty: 'true',
        })

        expect(filters).toEqual({
          $or: [
            { channel_id: { $in: [channelA, channelB] } },
            { channel_id: { $exists: false } },
          ],
        })
      })

      it('should not emit an $or when channelIdsEmpty accompanies an all-malformed channelIds', async () => {
        const options = buildDocumentCrudOptions(orderBinding)
        const filters = await options.list.buildFilters({
          channelIds: 'not-a-uuid',
          channelIdsEmpty: 'true',
        })

        expect(filters).toEqual({ channel_id: { $exists: false } })
      })

      it('should ignore channelIdsEmpty when it is not a truthy token', async () => {
        const options = buildDocumentCrudOptions(orderBinding)
        const filters = await options.list.buildFilters({ channelIdsEmpty: 'false' })

        expect(filters).toEqual({})
      })

      it('should drop malformed entries and keep the valid ones', async () => {
        const options = buildDocumentCrudOptions(orderBinding)
        const filters = await options.list.buildFilters({ channelIds: `not-a-uuid,${channelA},` })

        expect(filters).toEqual({ channel_id: { $in: [channelA] } })
      })

      it('should not filter at all when every channelIds entry is malformed', async () => {
        const options = buildDocumentCrudOptions(orderBinding)
        const filters = await options.list.buildFilters({ channelIds: 'not-a-uuid,also-not-a-uuid' })

        expect(filters).toEqual({})
      })

      it('should not filter when channelIds is empty', async () => {
        const options = buildDocumentCrudOptions(orderBinding)
        const filters = await options.list.buildFilters({ channelIds: '' })

        expect(filters).toEqual({})
      })

      it('should cap channelIds at the shared per-request id limit', async () => {
        const options = buildDocumentCrudOptions(orderBinding)
        const ids = Array.from(
          { length: MAX_IDS_PER_REQUEST + 50 },
          (_, index) => `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`,
        )
        const filters = await options.list.buildFilters({ channelIds: ids.join(',') })

        const applied = (filters as { channel_id?: { $in?: string[] } }).channel_id?.$in
        expect(applied).toHaveLength(MAX_IDS_PER_REQUEST)
        expect(applied?.[0]).toBe(ids[0])
        expect(applied).not.toContain(ids[MAX_IDS_PER_REQUEST])
      })

      it('should apply the same channel filtering to quotes', async () => {
        const options = buildDocumentCrudOptions(quoteBinding)
        const filters = await options.list.buildFilters({ channelIds: `${channelA},${channelB}` })

        expect(filters).toEqual({ channel_id: { $in: [channelA, channelB] } })
      })
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
  describe('afterList composition', () => {
    beforeEach(() => {
      mockRecalculateOrderTotalsForDisplay.mockReset()
    })

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

    // The channel-name resolution is appended to an afterList hook that already attaches tags.
    // Assigning the hook instead of extending it would silently drop that work, so this pins
    // that both still run off one list payload.
    it('should still attach tags alongside the channel names', async () => {
      const options = buildDocumentCrudOptions(orderBinding)
      const channelId = '11111111-1111-4111-8111-111111111111'
      const assignments = [
        { documentId: 'doc-1', tag: { id: 'tag-1', label: 'Priority', color: '#fff' } },
      ]
      const channels = [{ id: channelId, name: 'Web shop', code: 'web-shop' }]
      const entitiesSeen: string[] = []
      const em = {
        find: (entity: { name?: string }, where: Record<string, unknown>) => {
          const name = entity?.name ?? ''
          entitiesSeen.push(name)
          if ('documentId' in where) return Promise.resolve(assignments)
          const ids = ((where.id as { $in?: string[] })?.$in ?? []) as string[]
          return Promise.resolve(channels.filter((channel) => ids.includes(channel.id)))
        },
      }
      const ctx = {
        container: { resolve: (token: string) => (token === 'em' ? em : null) },
        auth: { tenantId: 'ten-1', orgId: 'org-1' },
        selectedOrganizationId: 'org-1',
      }
      // Two items keeps the single-order totals branch out of this test; it needs a live container.
      const payload = {
        items: [
          { id: 'doc-1', channelId },
          { id: 'doc-2', channelId: null },
        ] as Array<Record<string, unknown>>,
      }

      await options.hooks.afterList(payload, ctx as never)

      expect(payload.items[0].tags).toEqual([{ id: 'tag-1', label: 'Priority', color: '#fff' }])
      expect(payload.items[0].channelName).toBe('Web shop')
      expect(entitiesSeen).toHaveLength(2)
    })

    it('keeps persisted totals when the response contains exactly one order (#5438)', async () => {
      mockRecalculateOrderTotalsForDisplay.mockResolvedValue({
        subtotalNetAmount: 549.9,
        subtotalGrossAmount: 549.9,
        discountTotalAmount: 45,
        taxTotalAmount: 0,
        shippingNetAmount: 24.9,
        shippingGrossAmount: 24.9,
        surchargeTotalAmount: 0,
        grandTotalNetAmount: 549.9,
        grandTotalGrossAmount: 549.9,
        paidTotalAmount: 0,
        refundedTotalAmount: 0,
        outstandingAmount: 549.9,
      })

      const options = buildDocumentCrudOptions(orderBinding)
      const em = {
        find: jest.fn(async () => []),
        fork: jest.fn(function fork(this: { find: unknown }) {
          return this
        }),
      }
      const ctx = {
        container: { resolve: (token: string) => (token === 'em' ? em : null) },
        auth: { tenantId: 'ten-1', orgId: 'org-1' },
        selectedOrganizationId: 'org-1',
      }
      const payload = {
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            tenantId: 'ten-1',
            organizationId: 'org-1',
            grandTotalGrossAmount: 525,
            outstandingAmount: 525,
            subtotalGrossAmount: 570,
            shippingGrossAmount: 0,
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
        ] as Array<Record<string, unknown>>,
      }

      await options.hooks.afterList(payload, ctx as never)

      expect(mockRecalculateOrderTotalsForDisplay).not.toHaveBeenCalled()
      expect(em.fork).not.toHaveBeenCalled()
      expect(payload.items[0]).toEqual(
        expect.objectContaining({
          grandTotalGrossAmount: 525,
          outstandingAmount: 525,
          subtotalGrossAmount: 570,
          shippingGrossAmount: 0,
          updatedAt: '2026-08-01T00:00:00.000Z',
        }),
      )
    })
  })
})
