const container = { resolve: jest.fn() }
const ctx = {
  auth: { sub: 'u', tenantId: 't', orgId: 'o' },
  userId: 'u',
  tenantId: 't',
  organizationId: 'o',
  scope: { tenantId: 't', organizationId: 'o' },
  em: { flush: jest.fn() },
  container,
  eventBus: null,
}

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenant: string, fn: () => unknown) => fn(),
}))

jest.mock('../routeHelpers', () => ({
  resolveRequestContext: jest.fn(async () => ctx),
  resolveProposal: jest.fn(async () => ({ id: 'p' })),
  resolveActionAndProposal: jest.fn(async () => ({ action: { id: 'a', status: 'pending' }, proposal: { id: 'p' } })),
  handleRouteError: jest.fn((_err: unknown, label: string) => {
    const { NextResponse } = require('next/server')
    return NextResponse.json({ error: `Failed to ${label}` }, { status: 500 })
  }),
  isErrorResponse: jest.fn((value: unknown) => {
    const { NextResponse } = require('next/server')
    return value instanceof NextResponse
  }),
}))

jest.mock('../../lib/ensure-settings', () => ({ ensureInboxSettings: jest.fn() }))
jest.mock('../../lib/cache', () => ({
  resolveCache: jest.fn(() => ({})),
  invalidateCountsCache: jest.fn(),
  invalidateSettingsCache: jest.fn(),
  createSettingsCacheKey: jest.fn(),
  createSettingsCacheTag: jest.fn(),
  SETTINGS_CACHE_TTL_MS: 1,
}))
jest.mock('../../events', () => ({ emitInboxOpsEvent: jest.fn() }))

import { PATCH as settingsPatch } from '../settings/route'
import { PATCH as actionPatch } from '../proposals/[id]/actions/[actionId]/route'
import { POST as categorizePost } from '../proposals/[id]/categorize/route'

function badRequest(method: string, body: string): Request {
  return new Request('http://localhost/api/inbox_ops/x', {
    method,
    headers: { 'content-type': 'application/json' },
    body,
  })
}

describe('inbox_ops routes reject malformed JSON bodies with 400', () => {
  it.each([
    ['PATCH /settings', () => settingsPatch(badRequest('PATCH', '{not json'))],
    ['PATCH /proposals/[id]/actions/[actionId]', () => actionPatch(badRequest('PATCH', '{not json'))],
    ['POST /proposals/[id]/categorize', () => categorizePost(badRequest('POST', '{not json'))],
    ['empty body', () => settingsPatch(badRequest('PATCH', ''))],
  ])('%s', async (_name, call) => {
    const response = await call()
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' })
  })
})
