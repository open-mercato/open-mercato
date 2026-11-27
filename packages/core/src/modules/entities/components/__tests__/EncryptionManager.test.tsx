/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { dismissRecordConflict, getRecordConflictForTest } from '@open-mercato/ui/backend/conflicts'
import { EncryptionManager } from '../EncryptionManager'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key
const ENTITY_ID = 'customers:customer_comment'
const LOADED_AT = '2026-11-25T10:00:00.000Z'
const SAVED_AT = '2026-11-25T10:00:05.000Z'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => 1 }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => ({
  useCustomFieldDefs: () => ({ data: [], isLoading: false }),
}))
jest.mock('#generated/entity-fields-registry', () => ({ getEntityFields: () => ({ body: 'body' }) }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => {
  const { surfaceRecordConflict } = jest.requireActual('@open-mercato/ui/backend/conflicts')
  return {
    useGuardedMutation: () => ({
      runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => {
        try {
          return await operation()
        } catch (error) {
          surfaceRecordConflict(error, mockTranslate)
          throw error
        }
      },
    }),
  }
})
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
}))

const mockApiCall = jest.mocked(apiCall)
const mockRead = jest.mocked(readApiResultOrThrow)

function jsonResponse(body: unknown, status: number) {
  return { ok: status < 400, status, response: new Response(JSON.stringify(body), { status }), result: body }
}

function renderManager() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EncryptionManager />
    </QueryClientProvider>,
  )
}

async function findReadySaveButton() {
  await screen.findByRole('table')
  const save = screen.getByRole('button', { name: 'Save encryption map' })
  await waitFor(() => expect(save).toBeEnabled())
  return save
}

beforeEach(() => {
  jest.clearAllMocks()
  dismissRecordConflict()
  mockRead.mockImplementation(async (url: string) => {
    if (url === '/api/entities/entities') return { items: [{ entityId: ENTITY_ID }] }
    return { entityId: ENTITY_ID, fields: [{ field: 'body', hashField: null }], isActive: true, updatedAt: LOADED_AT }
  })
})

test('a double-click on save sends a single POST and raises no conflict', async () => {
  mockApiCall.mockResolvedValue(jsonResponse({ ok: true, updatedAt: SAVED_AT }, 200) as never)

  renderManager()
  const save = await findReadySaveButton()

  fireEvent.click(save)
  fireEvent.click(save)

  await waitFor(() => expect(flash).toHaveBeenCalledWith('Encryption map saved', 'success'))
  expect(mockApiCall.mock.calls.filter(([url]) => url === '/api/entities/encryption')).toHaveLength(1)
  expect(getRecordConflictForTest()).toBeNull()
})

test('a stale-write 409 shows the conflict bar, never flashes the raw error code, and refreshes in place', async () => {
  mockApiCall.mockResolvedValue(jsonResponse({
    error: 'record_modified',
    code: 'optimistic_lock_conflict',
    currentUpdatedAt: SAVED_AT,
    expectedUpdatedAt: LOADED_AT,
  }, 409) as never)

  renderManager()
  const save = await findReadySaveButton()
  fireEvent.click(save)

  await waitFor(() => expect(getRecordConflictForTest()).not.toBeNull())
  await waitFor(() => expect(save).toBeEnabled())
  expect(flash).not.toHaveBeenCalledWith('record_modified', 'error')
  expect(flash).not.toHaveBeenCalledWith(expect.anything(), 'error')

  const mapReads = () => mockRead.mock.calls.filter(([url]) => String(url).startsWith('/api/entities/encryption?')).length
  const readsBeforeRefresh = mapReads()
  getRecordConflictForTest()?.onRefresh?.()
  await waitFor(() => expect(mapReads()).toBe(readsBeforeRefresh + 1))
})

test('a non-conflict failure still flashes the server message', async () => {
  mockApiCall.mockResolvedValue(jsonResponse({ error: 'Invalid payload' }, 400) as never)

  renderManager()
  const save = await findReadySaveButton()
  fireEvent.click(save)

  await waitFor(() => expect(flash).toHaveBeenCalledWith('Invalid payload', 'error'))
  expect(getRecordConflictForTest()).toBeNull()
})
