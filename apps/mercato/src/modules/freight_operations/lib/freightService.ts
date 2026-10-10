import type { EntityManager } from '@mikro-orm/postgresql'
import { FreightOrder, FreightTrip, FreightTripAbstract } from '../data/entities'
import type { FreightScope } from './freightSettings'

export type FreightDashboardSummary = {
  openOrders: number
  ordersAwaitingPod: number
  ordersAwaitingInvoice: number
  invoicedOrders: number
  unbilledTrips: number
  abstractsAwaitingCustomer: number
  approvedNotInvoiced: number
  overdueInvoices: number
  outstandingAmount: string
}

export type FreightService = {
  getDashboardSummary(scope: FreightScope): Promise<FreightDashboardSummary>
}

export function createFreightService(em: EntityManager): FreightService {
  return {
    async getDashboardSummary(scope) {
      const base = { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const [
        openOrders,
        ordersAwaitingPod,
        ordersAwaitingInvoice,
        invoicedOrders,
        unbilledTrips,
        abstractsAwaitingCustomer,
        approvedNotInvoiced,
        overdueInvoices,
        outstandingRows,
      ] = await Promise.all([
        em.count(FreightOrder, { ...base, status: { $in: ['confirmed', 'assigned', 'in_transit'] } }),
        em.count(FreightOrder, { ...base, status: 'delivered' }),
        em.count(FreightOrder, { ...base, status: 'completed' }),
        em.count(FreightOrder, { ...base, status: 'invoiced' }),
        em.count(FreightTrip, { ...base, billingStatus: 'unbilled', executionStatus: 'delivered' }),
        em.count(FreightTripAbstract, { ...base, status: { $in: ['submitted', 'disputed'] } }),
        em.count(FreightTripAbstract, { ...base, status: 'approved' }),
        em.count(FreightTripAbstract, { ...base, status: 'invoiced', dueDate: { $lt: today }, outstandingAmount: { $ne: '0' } }),
        em.getConnection().execute<{ total: string | null }[]>(
          `select coalesce(sum(outstanding_amount), 0)::text as total from freight_trip_abstracts
           where tenant_id = ? and organization_id = ? and deleted_at is null and status = 'invoiced'`,
          [scope.tenantId, scope.organizationId],
        ),
      ])

      return {
        openOrders,
        ordersAwaitingPod,
        ordersAwaitingInvoice,
        invoicedOrders,
        unbilledTrips,
        abstractsAwaitingCustomer,
        approvedNotInvoiced,
        overdueInvoices,
        outstandingAmount: outstandingRows[0]?.total ?? '0',
      }
    },
  }
}
