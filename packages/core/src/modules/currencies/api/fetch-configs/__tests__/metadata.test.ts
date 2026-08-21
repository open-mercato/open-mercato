/** @jest-environment node */
// Regression coverage for finding #6 in report-high.md: privilege escalation
// because POST/PUT/DELETE were silently gated by `currencies.fetch.view`
// rather than the dedicated `currencies.fetch.manage` feature. The dispatcher's
// `extractMethodMetadata` only honors per-method overrides when the metadata
// object is method-keyed, so a flat `requireFeatures` re-applies the read
// feature to every HTTP verb — the bug fixed here.

// Avoid pulling MikroORM decorators / DI container / regex-engine chain at
// import time. The route module only needs the metadata export to be reachable;
// command and entity bodies are irrelevant to the contract we're asserting.
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/currencies/data/entities', () => ({
  CurrencyFetchConfig: class CurrencyFetchConfig {},
}))

jest.mock('@open-mercato/core/modules/currencies/commands/fetch-configs', () => ({
  createFetchConfig: jest.fn(),
  updateFetchConfig: jest.fn(),
  deleteFetchConfig: jest.fn(),
}))

import { metadata } from '@open-mercato/core/modules/currencies/api/fetch-configs/route'

type MethodMetadata = { requireAuth?: boolean; requireFeatures?: string[] }
type RouteMetadata = Record<string, unknown> & {
  GET?: MethodMetadata
  POST?: MethodMetadata
  PUT?: MethodMetadata
  DELETE?: MethodMetadata
  requireFeatures?: string[]
}

describe('currencies fetch-configs route metadata', () => {
  const meta = metadata as RouteMetadata

  it('uses method-keyed metadata so write verbs are not silently gated by the read feature', () => {
    expect(meta.requireFeatures).toBeUndefined()
    expect(meta.GET).toBeDefined()
    expect(meta.POST).toBeDefined()
    expect(meta.PUT).toBeDefined()
    expect(meta.DELETE).toBeDefined()
  })

  it('gates GET on the read-only currencies.fetch.view feature', () => {
    expect(meta.GET?.requireAuth).toBe(true)
    expect(meta.GET?.requireFeatures).toEqual(['currencies.fetch.view'])
  })

  it('gates POST on the write currencies.fetch.manage feature', () => {
    expect(meta.POST?.requireAuth).toBe(true)
    expect(meta.POST?.requireFeatures).toEqual(['currencies.fetch.manage'])
  })

  it('gates PUT on the write currencies.fetch.manage feature', () => {
    expect(meta.PUT?.requireAuth).toBe(true)
    expect(meta.PUT?.requireFeatures).toEqual(['currencies.fetch.manage'])
  })

  it('gates DELETE on the write currencies.fetch.manage feature', () => {
    expect(meta.DELETE?.requireAuth).toBe(true)
    expect(meta.DELETE?.requireFeatures).toEqual(['currencies.fetch.manage'])
  })
})
