/**
 * Phase 2 (record-locks customers): Notes (customer_comment) merge-dialog surface.
 *
 * The notes adapter writes through the makeCrudRoute `customers/comments` route
 * (server-side optimistic-lock guard auto-covered by the CRUD mutation-guard
 * decorator), so the client gap was that the adapter never sent the expected-version
 * header. This test asserts the update/delete adapter calls attach the
 * `x-om-ext-optimistic-lock-expected-updated-at` header derived from the note's
 * loaded `updatedAt`. The guarded runner (useGuardedMutation) routes the resulting
 * 409 through surfaceRecordConflict, so no per-adapter conflict handling is needed.
 */
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const apiCallOrThrowMock = jest.fn(async () => ({ ok: true, response: new Response(), result: {} }))
const withScopedApiRequestHeadersMock = jest.fn(
  async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
)

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...(args as [])),
  readApiResultOrThrow: jest.fn(async () => ({})),
  withScopedApiRequestHeaders: (headers: Record<string, string>, run: () => Promise<unknown>) =>
    withScopedApiRequestHeadersMock(headers, run),
}))

jest.mock('@open-mercato/ui/backend/detail/NotesSection', () => ({
  mapCommentSummary: (input: unknown) => input,
}))

import { createCustomerNotesAdapter } from '../notesAdapter'

const translator = (key: string, fallback?: string) => fallback ?? key
const UPDATED_AT = '2026-06-01T00:00:00.000Z'

beforeEach(() => {
  apiCallOrThrowMock.mockClear()
  withScopedApiRequestHeadersMock.mockClear()
})

describe('createCustomerNotesAdapter — optimistic-lock header', () => {
  test('update attaches the version header derived from the note updatedAt', async () => {
    const adapter = createCustomerNotesAdapter(translator)
    await adapter.update({ id: 'note-1', patch: { body: 'edited' }, updatedAt: UPDATED_AT })

    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledTimes(1)
    expect(withScopedApiRequestHeadersMock.mock.calls[0][0]).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT })
    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
  })

  test('delete attaches the version header derived from the note updatedAt', async () => {
    const adapter = createCustomerNotesAdapter(translator)
    await adapter.delete({ id: 'note-1', updatedAt: UPDATED_AT })

    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledTimes(1)
    expect(withScopedApiRequestHeadersMock.mock.calls[0][0]).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT })
  })

  test('a missing updatedAt sends no header value (strictly additive — no lock)', async () => {
    const adapter = createCustomerNotesAdapter(translator)
    await adapter.update({ id: 'note-1', patch: { body: 'edited' }, updatedAt: null })

    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledTimes(1)
    expect(withScopedApiRequestHeadersMock.mock.calls[0][0]).toEqual({})
  })

  test('writes route through the guarded runner when provided', async () => {
    const runMutation = jest.fn(async (runner: () => Promise<unknown>) => runner())
    const adapter = createCustomerNotesAdapter(translator, { runMutation })
    await adapter.update({ id: 'note-1', patch: { body: 'edited' }, updatedAt: UPDATED_AT })

    expect(runMutation).toHaveBeenCalledTimes(1)
    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledTimes(1)
  })
})
