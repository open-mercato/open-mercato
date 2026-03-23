import { match, P } from 'ts-pattern'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { Provider, Address, PackageDimension, ShippingRate, DocumentAddress, DropOffPoint } from '../types'

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
  receiverPhone?: string
  receiverEmail?: string
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
  senderPhone?: string
  senderEmail?: string
  receiverPhone?: string
  receiverEmail?: string
  targetPoint?: string
  c2cSendingMethod?: string
}

export type CreateShipmentResult =
  | { ok: true }
  | { ok: false; error: string }

export type FetchDropOffPointsParams = {
  providerKey: string
  query?: string
  type?: string
  postCode?: string
}

export type FetchDropOffPointsResult =
  | { ok: true; points: DropOffPoint[] }
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
  const { providerKey, origin, destination, packages, receiverPhone, receiverEmail } = params
  const call = await apiCall<{ rates: ShippingRate[] }>(
    '/api/shipping-carriers/rates',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerKey,
        origin,
        destination,
        packages,
        ...(receiverPhone !== undefined ? { receiverPhone } : {}),
        ...(receiverEmail !== undefined ? { receiverEmail } : {}),
      }),
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

export const fetchDropOffPoints = async (params: FetchDropOffPointsParams): Promise<FetchDropOffPointsResult> => {
  const url = new URL('/api/shipping-carriers/points', 'http://placeholder')
  url.searchParams.set('providerKey', params.providerKey)
  if (params.query) url.searchParams.set('query', params.query)
  if (params.type) url.searchParams.set('type', params.type)
  if (params.postCode) url.searchParams.set('postCode', params.postCode)

  const call = await apiCall<{ points: DropOffPoint[] }>(
    `${url.pathname}${url.search}`,
    undefined,
    { fallback: { points: [] } },
  )
  return match(call)
    .with({ ok: true, result: P.not(P.nullish) }, ({ result }) => ({
      ok: true as const,
      points: result.points,
    }))
    .otherwise(({ result }) => ({
      ok: false as const,
      error: (result as { error?: string } | null)?.error ?? 'Failed to fetch drop-off points.',
    }))
}
