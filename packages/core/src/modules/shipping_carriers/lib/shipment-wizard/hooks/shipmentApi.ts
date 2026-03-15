import { match, P } from 'ts-pattern'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { Provider, Address, PackageDimension, ShippingRate, DocumentAddress } from '../types'

export type FetchProvidersResult =
  | { ok: true; providers: Provider[] }
  | { ok: false; error: string }

export type FetchOrderAddressesResult =
  | { ok: true; items: DocumentAddress[] }
  | { ok: false }

export type FetchRatesParams = {
  providerKey: string
  origin: Address
  destination: Address
  packages: PackageDimension[]
}

export type FetchRatesResult =
  | { ok: true; rates: ShippingRate[] }
  | { ok: false; error: string }

export type CreateShipmentParams = {
  providerKey: string
  orderId: string
  origin: Address
  destination: Address
  packages: PackageDimension[]
  serviceCode: string
  labelFormat: string
}

export type CreateShipmentResult =
  | { ok: true }
  | { ok: false; error: string }

export const fetchProviders = async (): Promise<FetchProvidersResult> => {
  const call = await apiCall<{ providers: Provider[] }>(
    '/api/shipping-carriers/providers',
    undefined,
    { fallback: { providers: [] } },
  )
  return match(call)
    .with({ ok: true, result: P.not(P.nullish) }, ({ result }) => ({
      ok: true as const,
      providers: result.providers,
    }))
    .otherwise(() => ({ ok: false as const, error: 'Failed to load shipping providers.' }))
}

export const fetchOrderAddresses = async (orderId: string): Promise<FetchOrderAddressesResult> => {
  const call = await apiCall<{ items: DocumentAddress[] }>(
    `/api/sales/document-addresses?documentId=${orderId}&documentKind=order&pageSize=50`,
    undefined,
    { fallback: { items: [] } },
  )
  return match(call)
    .with({ ok: true, result: P.not(P.nullish) }, ({ result }) => ({
      ok: true as const,
      items: result.items,
    }))
    .otherwise(() => ({ ok: false as const }))
}

export const fetchRates = async (params: FetchRatesParams): Promise<FetchRatesResult> => {
  const { providerKey, origin, destination, packages } = params
  const call = await apiCall<{ rates: ShippingRate[] }>(
    '/api/shipping-carriers/rates',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerKey, origin, destination, packages }),
    },
    { fallback: { rates: [] } },
  )
  return match(call)
    .with({ ok: true, result: P.not(P.nullish) }, ({ result }) => ({
      ok: true as const,
      rates: result.rates,
    }))
    .otherwise(({ result }) => ({
      ok: false as const,
      error: (result as { error?: string } | null)?.error ?? 'Failed to fetch shipping rates.',
    }))
}

export const createShipment = async (params: CreateShipmentParams): Promise<CreateShipmentResult> => {
  const call = await apiCall(
    '/api/shipping-carriers/shipments',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    },
    { fallback: null },
  )
  return match(call)
    .with({ ok: true }, () => ({ ok: true as const }))
    .otherwise(({ result }) => ({
      ok: false as const,
      error: (result as { error?: string } | null)?.error ?? 'Failed to create shipment.',
    }))
}
