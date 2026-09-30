/** @jest-environment node */

import type { DataSyncAdapter } from '../../lib/adapter'

const mockGetAuthFromRequest = jest.fn()
const mockGetAllIntegrations = jest.fn()
const mockGetDataSyncAdapter = jest.fn()

const mockCredentialsService = {
  resolve: jest.fn(),
}

const mockStateService = {
  resolveState: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'integrationCredentialsService') return mockCredentialsService
      if (token === 'integrationStateService') return mockStateService
      throw new Error(`Unexpected token: ${token}`)
    },
  })),
}))

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  getAllIntegrations: () => mockGetAllIntegrations(),
}))

jest.mock('../../lib/adapter-registry', () => ({
  getDataSyncAdapter: (providerKey: string) => mockGetDataSyncAdapter(providerKey),
}))

import { GET } from '../options'

type OptionsItem = {
  integrationId: string
  supportedEntities: string[]
  startControls: Record<string, { fullSync: boolean; batchSize: boolean }>
}

function buildAdapter(overrides: Partial<DataSyncAdapter> = {}): DataSyncAdapter {
  return {
    providerKey: 'mixed',
    direction: 'import',
    supportedEntities: ['orders.feed', 'orders.backfill'],
    getMapping: async ({ entityType }) => ({ entityType, matchStrategy: 'externalId' as const, fields: [] }),
    ...overrides,
  }
}

async function readItems(): Promise<OptionsItem[]> {
  const response = await GET(new Request('http://localhost/api/data_sync/options'))
  expect(response.status).toBe(200)
  const body = await response.json()
  return body.items as OptionsItem[]
}

describe('data_sync options route start controls', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    mockGetAllIntegrations.mockReturnValue([
      { id: 'sync_mixed', title: 'Mixed', hub: 'data_sync', providerKey: 'mixed' },
    ])
    mockCredentialsService.resolve.mockResolvedValue({})
    mockStateService.resolveState.mockResolvedValue({ isEnabled: true })
  })

  it('ships an empty map for an adapter that declares nothing, so the form is unchanged', async () => {
    mockGetDataSyncAdapter.mockReturnValue(buildAdapter())

    const [item] = await readItems()
    expect(item.startControls).toEqual({})
  })

  it('resolves the predicate per entity type and ships only the restrictions', async () => {
    mockGetDataSyncAdapter.mockReturnValue(buildAdapter({
      supportsStartControl: (control, entityType) => !(control === 'fullSync' && entityType === 'orders.backfill'),
    }))

    const [item] = await readItems()
    expect(item.startControls).toEqual({
      'orders.backfill': { fullSync: false, batchSize: true },
    })
    expect(Object.keys(item.startControls).every((key) => item.supportedEntities.includes(key))).toBe(true)
  })

  it('still answers 200 when an adapter predicate throws', async () => {
    mockGetDataSyncAdapter.mockReturnValue(buildAdapter({
      supportsStartControl: () => {
        throw new Error('[internal] adapter predicate blew up')
      },
    }))

    const [item] = await readItems()
    expect(item.startControls).toEqual({})
  })
})
