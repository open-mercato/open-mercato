"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

/**
 * The lookups every freight screen needs: the CRM billing parties (from the
 * customers endpoints, the same two the sales document form reads) and the fleet
 * master data (through the module's own tolerant reference endpoint, so the
 * screens keep working when transport_operations is disabled).
 */

export type FreightCustomerOption = {
  id: string
  kind: 'person' | 'company'
  displayName: string
  primaryEmail: string | null
  primaryPhone: string | null
}

export type FreightCustomerSnapshot = {
  id: string
  kind: 'person' | 'company'
  displayName: string
  primaryEmail: string | null
  primaryPhone: string | null
}

export type TransportReference = {
  available: boolean
  vehicles: Array<{ id: string; plateNumber: string; make: string; model: string; status: string }>
  drivers: Array<{ id: string; fullName: string; phone: string; status: string; licenseNumber: string; licenseExpiry: string | null }>
  routes: Array<{ id: string; code: string; name: string; startLocation: string; endLocation: string }>
}

// Stable fallback references so the option memos below do not re-run on every
// render while the queries are still pending.
const EMPTY_CUSTOMERS: FreightCustomerOption[] = []
const EMPTY_CHANNELS: Array<{ value: string; label: string }> = []
const EMPTY_RATE_LINES: ContractRateLineOption[] = []
const EMPTY_ORDERS: TripReadyOrderOption[] = []
const EMPTY_REFERENCE: TransportReference = { available: false, vehicles: [], drivers: [], routes: [] }

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value : null
}

function parseCustomerItems(items: unknown[], kind: 'person' | 'company'): FreightCustomerOption[] {
  return items.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const record = raw as Record<string, unknown>
    const id = readString(record.id)
    if (!id) return []
    const displayName =
      readString(record.display_name) ??
      readString(record.displayName) ??
      readString(record.name) ??
      id
    return [{
      id,
      kind,
      displayName,
      primaryEmail: readString(record.primary_email) ?? readString(record.primaryEmail),
      primaryPhone: readString(record.primary_phone) ?? readString(record.primaryPhone),
    }]
  })
}

export function useCustomerOptions() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['freight-customer-options', scopeVersion],
    queryFn: async (): Promise<FreightCustomerOption[]> => {
      const params = new URLSearchParams({ page: '1', pageSize: '100' })
      const [people, companies] = await Promise.all([
        apiCall<{ items?: unknown[] }>(`/api/customers/people?${params.toString()}`),
        apiCall<{ items?: unknown[] }>(`/api/customers/companies?${params.toString()}`),
      ])
      const peopleItems = Array.isArray(people.result?.items) ? people.result?.items ?? [] : []
      const companyItems = Array.isArray(companies.result?.items) ? companies.result?.items ?? [] : []
      return [...parseCustomerItems(companyItems, 'company'), ...parseCustomerItems(peopleItems, 'person')]
    },
    staleTime: 5 * 60 * 1000,
  })
  const customers = query.data ?? EMPTY_CUSTOMERS
  const options = React.useMemo(
    () => customers.map((customer) => ({ value: customer.id, label: customer.displayName })),
    [customers],
  )
  const byId = React.useMemo(() => {
    const map = new Map<string, FreightCustomerOption>()
    for (const customer of customers) map.set(customer.id, customer)
    return map
  }, [customers])
  const toSnapshot = React.useCallback(
    (id: string): FreightCustomerSnapshot | null => {
      const customer = byId.get(id)
      if (!customer) return null
      return {
        id: customer.id,
        kind: customer.kind,
        displayName: customer.displayName,
        primaryEmail: customer.primaryEmail,
        primaryPhone: customer.primaryPhone,
      }
    },
    [byId],
  )
  return { customers, options, byId, toSnapshot, isLoading: query.isLoading }
}

export function useTransportReference() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['freight-transport-reference', scopeVersion],
    queryFn: async (): Promise<TransportReference> => {
      const call = await apiCall<TransportReference>('/api/freight_operations/reference/transport')
      return call.result ?? EMPTY_REFERENCE
    },
    staleTime: 60 * 1000,
  })
  const reference = query.data ?? EMPTY_REFERENCE
  const vehicleOptions = React.useMemo(
    () => reference.vehicles.map((vehicle) => ({ value: vehicle.id, label: `${vehicle.plateNumber} · ${vehicle.make} ${vehicle.model}`.trim() })),
    [reference.vehicles],
  )
  const driverOptions = React.useMemo(
    () => reference.drivers.map((driver) => ({ value: driver.id, label: `${driver.fullName} (${driver.licenseNumber})`.trim() })),
    [reference.drivers],
  )
  const routeOptions = React.useMemo(
    () => reference.routes.map((route) => ({ value: route.id, label: `${route.code} · ${route.name}`.trim() })),
    [reference.routes],
  )
  return { reference, vehicleOptions, driverOptions, routeOptions }
}

export type ContractRateLineOption = {
  value: string
  label: string
  contractId: string
  currencyCode: string
}

export type TripReadyOrderOption = {
  value: string
  label: string
}

const TRIP_READY_ORDER_STATUSES = new Set(['confirmed', 'assigned', 'in_transit', 'delivered', 'completed'])

/**
 * A trip is recorded against a contract *rate line*, and the contract is what
 * that line belongs to — so the picker lists lines, labelled with their contract
 * number, and the form derives the contract id from the chosen line. The routes
 * have no cross-filter for this join, so both lists load at the shared 100-row
 * page cap and are joined client-side like the customer picker.
 */
export function useContractRateLineOptions() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['freight-contract-rate-line-options', scopeVersion],
    queryFn: async (): Promise<ContractRateLineOption[]> => {
      const [contractsCall, linesCall] = await Promise.all([
        apiCall<{ items?: Array<Record<string, unknown>> }>('/api/freight_operations/contracts?status=active&pageSize=100'),
        apiCall<{ items?: Array<Record<string, unknown>> }>('/api/freight_operations/contract-routes?isActive=true&pageSize=100'),
      ])
      const contracts = new Map<string, Record<string, unknown>>()
      for (const raw of contractsCall.result?.items ?? []) {
        const id = readString(raw.id)
        if (id) contracts.set(id, raw)
      }
      const options: ContractRateLineOption[] = []
      for (const raw of linesCall.result?.items ?? []) {
        const id = readString(raw.id)
        const contractId = readString(raw.contract_id)
        if (!id || !contractId) continue
        const contract = contracts.get(contractId)
        const contractNumber = contract ? readString(contract.contract_number) ?? contractId : contractId
        const origin = readString(raw.origin) ?? ''
        const destination = readString(raw.destination) ?? ''
        options.push({
          value: id,
          label: `${contractNumber} · ${origin} → ${destination}`.trim(),
          contractId,
          currencyCode: readString(raw.currency_code) ?? readString(contract?.currency_code ?? null) ?? 'SAR',
        })
      }
      return options
    },
    staleTime: 60 * 1000,
  })
  const options = query.data ?? EMPTY_RATE_LINES
  const byId = React.useMemo(() => {
    const map = new Map<string, ContractRateLineOption>()
    for (const option of options) map.set(option.value, option)
    return map
  }, [options])
  const selectOptions = React.useMemo(
    () => options.map((option) => ({ value: option.value, label: option.label })),
    [options],
  )
  return { options: selectOptions, byId, truncated: options.length >= 100 }
}

/**
 * Spot trips attach to an order that has been confirmed — the API refuses the
 * draft, invoiced and cancelled ones. The orders route filters by a single
 * status, so the trip-ready set is filtered here instead of by six requests.
 */
export function useTripReadyOrderOptions() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['freight-trip-ready-orders', scopeVersion],
    queryFn: async (): Promise<TripReadyOrderOption[]> => {
      const call = await apiCall<{ items?: Array<Record<string, unknown>> }>('/api/freight_operations/orders?pageSize=100&sortField=created_at&sortDir=desc')
      return (call.result?.items ?? []).flatMap((raw) => {
        const id = readString(raw.id)
        const status = readString(raw.status)
        if (!id || !status || !TRIP_READY_ORDER_STATUSES.has(status)) return []
        const number = readString(raw.order_number) ?? id
        const pickup = readString(raw.pickup_location) ?? ''
        const dropoff = readString(raw.dropoff_location) ?? ''
        return [{ value: id, label: `${number} · ${pickup} → ${dropoff}`.trim() }]
      })
    },
    staleTime: 60 * 1000,
  })
  return query.data ?? EMPTY_ORDERS
}

export function useSalesChannelOptions() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['freight-sales-channel-options', scopeVersion],
    queryFn: async (): Promise<Array<{ value: string; label: string }>> => {
      const call = await apiCall<{ items?: Array<Record<string, unknown>> }>('/api/sales/channels?page=1&pageSize=100')
      const items = Array.isArray(call.result?.items) ? call.result?.items ?? [] : []
      return items.flatMap((raw) => {
        const id = readString(raw.id)
        if (!id) return []
        const name = readString(raw.name) ?? readString(raw.code) ?? id
        return [{ value: id, label: name }]
      })
    },
    staleTime: 5 * 60 * 1000,
  })
  return query.data ?? EMPTY_CHANNELS
}

export function customerNameOf(snapshot: unknown, fallback = '—'): string {
  if (!snapshot || typeof snapshot !== 'object') return fallback
  const value = (snapshot as Record<string, unknown>).displayName
  return typeof value === 'string' && value.trim().length ? value : fallback
}

/**
 * Money on every freight surface renders as Western-digit plain decimals
 * (ZATCA requires plain decimals on documents, and the KSA numeral policy keeps
 * them consistent across locales).
 */
export function formatFreightAmount(amount: string | number | null | undefined, currencyCode = 'SAR'): string {
  if (amount === null || amount === undefined || amount === '') return '—'
  const parsed = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(parsed)) return '—'
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parsed)
  return `${currencyCode} ${formatted}`
}

export function formatFreightDate(value: string | null | undefined, locale?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(locale, { dateStyle: 'medium' })
}
