"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

/**
 * The lookups every rental screen needs: the CRM billing parties (from the
 * customers endpoints, the same two the sales document form reads) and the fleet
 * master data (through the module's own tolerant reference endpoint, so the
 * screens keep working when transport_operations is disabled).
 */

export type RentalCustomerOption = {
  id: string
  kind: 'person' | 'company'
  displayName: string
  primaryEmail: string | null
  primaryPhone: string | null
}

export type RentalCustomerSnapshot = {
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
}

// Stable fallback references so the option memos below do not re-run on every
// render while the queries are still pending.
const EMPTY_CUSTOMERS: RentalCustomerOption[] = []
const EMPTY_REFERENCE: TransportReference = { available: false, vehicles: [], drivers: [] }

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value : null
}

function parseCustomerItems(items: unknown[], kind: 'person' | 'company'): RentalCustomerOption[] {
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
    queryKey: ['rental-customer-options', scopeVersion],
    queryFn: async (): Promise<RentalCustomerOption[]> => {
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
    const map = new Map<string, RentalCustomerOption>()
    for (const customer of customers) map.set(customer.id, customer)
    return map
  }, [customers])
  const toSnapshot = React.useCallback(
    (id: string): RentalCustomerSnapshot | null => {
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
    queryKey: ['rental-transport-reference', scopeVersion],
    queryFn: async (): Promise<TransportReference> => {
      const call = await apiCall<TransportReference>('/api/vehicle_rentals/reference/transport')
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
  return { reference, vehicleOptions, driverOptions }
}

export function customerNameOf(snapshot: unknown, fallback = '—'): string {
  if (!snapshot || typeof snapshot !== 'object') return fallback
  const value = (snapshot as Record<string, unknown>).displayName
  return typeof value === 'string' && value.trim().length ? value : fallback
}

/**
 * Money on every rental surface renders as Western-digit plain decimals
 * (ZATCA requires plain decimals on documents, and the KSA numeral policy keeps
 * them consistent across locales).
 */
export function formatRentalAmount(amount: string | number | null | undefined, currencyCode = 'SAR'): string {
  if (amount === null || amount === undefined || amount === '') return '—'
  const parsed = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(parsed)) return '—'
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parsed)
  return `${currencyCode} ${formatted}`
}

export function formatRentalDate(value: string | null | undefined, locale?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(locale, { dateStyle: 'medium' })
}
