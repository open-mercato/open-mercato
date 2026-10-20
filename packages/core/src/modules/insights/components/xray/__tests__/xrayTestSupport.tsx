import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import enDictionary from '../../../i18n/en.json'

export const XRAY_DICT: Record<string, string> = {
  ...(enDictionary as Record<string, string>),
  'customers.insights.process.deal': 'Deal',
}

export const TENANT_ID = '11111111-0000-4000-8000-000000000001'
export const ORG_ID = '22222222-0000-4000-8000-000000000001'
export const SUGGESTION_ID = '33333333-0000-4000-8000-000000000001'
export const DEFINITION_ID = '44444444-0000-4000-8000-000000000001'
export const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

export type FakeResponse = {
  ok: boolean
  status: number
  headers: { get: (name: string) => string | null }
  clone: () => FakeResponse
  text: () => Promise<string>
  json: () => Promise<unknown>
}

/** A minimal `Response` stand-in for `apiFetch` mocks (jsdom has no fetch). */
export function fakeResponse(status: number, body: unknown): FakeResponse {
  const text = body === undefined ? '' : JSON.stringify(body)
  const response: FakeResponse = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    clone: () => response,
    text: async () => text,
    json: async () => (text ? JSON.parse(text) : null),
  }
  return response
}

export type RecordedRequest = { url: URL; method: string; headers: Record<string, string>; body: unknown }

/** Normalizes the arguments of an `apiFetch` call for assertions. */
export function recordRequest(input: unknown, init?: RequestInit): RecordedRequest {
  const url = new URL(String(input), 'http://localhost')
  const headers: Record<string, string> = {}
  const source = init?.headers
  if (source instanceof Headers) source.forEach((value, key) => { headers[key.toLowerCase()] = value })
  else if (Array.isArray(source)) for (const [key, value] of source) headers[key.toLowerCase()] = value
  else if (source) for (const [key, value] of Object.entries(source)) headers[key.toLowerCase()] = String(value)
  let body: unknown = undefined
  if (typeof init?.body === 'string' && init.body.length > 0) body = JSON.parse(init.body)
  return { url, method: (init?.method ?? 'GET').toUpperCase(), headers, body }
}

export function renderXray(ui: React.ReactElement) {
  return renderWithProviders(ui, { dict: XRAY_DICT })
}

export const envelope = {
  processKey: 'customers.deal',
  organizationIds: [ORG_ID],
  window: { from: '2026-09-11T00:00:00.000Z', to: '2026-10-11T00:00:00.000Z', windowKey: '30d', timeZone: 'UTC' },
  n: 42,
  lowConfidence: false,
  computedThrough: '2026-10-10T10:00:00.000000Z',
  incomplete: false,
  kAnonymity: 5,
  suppressed: { cells: 0, minCases: 0, minActors: 0, complementary: 0 },
  source: 'live' as const,
}

export function causes(human: number, automated = 0, legacy = 0) {
  return { human, automated, legacy, other: 0, byKind: {} }
}
