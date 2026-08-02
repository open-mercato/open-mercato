/**
 * Record-locks coverage (resources notes): the resources comments adapter writes
 * through the makeCrudRoute `resources/comments` route (server-side optimistic-lock
 * guard via the CRUD mutation-guard decorator). The client gap was that the adapter
 * never sent the expected-version header. This test asserts the update/delete
 * adapter calls attach the `x-om-ext-optimistic-lock-expected-updated-at` header
 * derived from the note's loaded `updatedAt`. The resulting 409 is surfaced by the
 * shared NotesSection host through `surfaceRecordConflict` (see
 * NotesSection.test.tsx), so no per-adapter conflict handling is needed.
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

import { createResourceNotesAdapter } from '../notesAdapter'

const translator = (key: string, fallback?: string) => fallback ?? key
const UPDATED_AT = '2026-06-01T00:00:00.000Z'

beforeEach(() => {
  apiCallOrThrowMock.mockClear()
  withScopedApiRequestHeadersMock.mockClear()
})

describe('createResourceNotesAdapter — optimistic-lock header', () => {
  test('update attaches the version header derived from the note updatedAt', async () => {
    const adapter = createResourceNotesAdapter(translator)
    await adapter.update({ id: 'note-1', patch: { body: 'edited' }, updatedAt: UPDATED_AT })

    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledTimes(1)
    expect(withScopedApiRequestHeadersMock.mock.calls[0][0]).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT })
    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
  })

  test('delete attaches the version header derived from the note updatedAt', async () => {
    const adapter = createResourceNotesAdapter(translator)
    await adapter.delete({ id: 'note-1', updatedAt: UPDATED_AT })

    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledTimes(1)
    expect(withScopedApiRequestHeadersMock.mock.calls[0][0]).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT })
  })

  test('a missing updatedAt sends no header value (strictly additive — no lock)', async () => {
    const adapter = createResourceNotesAdapter(translator)
    await adapter.update({ id: 'note-1', patch: { body: 'edited' }, updatedAt: null })

    expect(withScopedApiRequestHeadersMock).toHaveBeenCalledTimes(1)
    expect(withScopedApiRequestHeadersMock.mock.calls[0][0]).toEqual({})
  })
})
