import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { resolveSsoAdminErrorMessage, surfaceSsoAdminError } from '../surfaceSsoAdminError'

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn() }))

const flashMock = flash as jest.Mock
const surfaceRecordConflictMock = surfaceRecordConflict as jest.Mock
const t = (key: string, fallback?: string) => fallback ?? key

function httpError(message: string, status: number, body: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { status, ...body })
}

describe('surfaceSsoAdminError', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    surfaceRecordConflictMock.mockReturnValue(false)
  })

  it('flashes the translated server refusal message and returns it', () => {
    const refusal = 'You cannot grant a role or feature above your own permissions.'
    const message = surfaceSsoAdminError(httpError(refusal, 403), t, 'Failed to save role mappings')
    expect(message).toBe(refusal)
    expect(flashMock).toHaveBeenCalledWith(refusal, 'error')
  })

  it('falls back to the caller message when the error has no usable message', () => {
    expect(surfaceSsoAdminError(httpError('   ', 500), t, 'Failed to save')).toBe('Failed to save')
    expect(surfaceSsoAdminError('boom', t, 'Failed to save')).toBe('Failed to save')
    expect(flashMock).toHaveBeenNthCalledWith(1, 'Failed to save', 'error')
    expect(flashMock).toHaveBeenNthCalledWith(2, 'Failed to save', 'error')
  })

  it('routes 409 optimistic-lock conflicts to the conflict bar instead of a flash', () => {
    surfaceRecordConflictMock.mockReturnValue(true)
    const onRefresh = jest.fn()
    const conflict = httpError('conflict', 409, { code: 'optimistic_lock_conflict' })
    expect(surfaceSsoAdminError(conflict, t, 'Failed to save', { onRefresh })).toBeNull()
    expect(surfaceRecordConflictMock).toHaveBeenCalledWith(conflict, t, { onRefresh })
    expect(flashMock).not.toHaveBeenCalled()
  })

  it('uses the translated fallback instead of the server message for any 5xx', () => {
    expect(resolveSsoAdminErrorMessage(httpError('Internal server error', 500), 'Nie udało się utworzyć konfiguracji SSO'))
      .toBe('Nie udało się utworzyć konfiguracji SSO')
    expect(resolveSsoAdminErrorMessage(httpError('Upstream exploded', 502), 'Failed to delete')).toBe('Failed to delete')
    expect(surfaceSsoAdminError(httpError('Internal server error', 503), t, 'Failed to add domain')).toBe('Failed to add domain')
    expect(flashMock).toHaveBeenCalledWith('Failed to add domain', 'error')
  })

  it('uses the translated fallback when the message is the generic internal-error text', () => {
    expect(resolveSsoAdminErrorMessage(new Error('Internal server error'), 'Failed to save')).toBe('Failed to save')
    expect(resolveSsoAdminErrorMessage(new Error('  internal SERVER error '), 'Failed to save')).toBe('Failed to save')
  })

  it('keeps the server message for 4xx responses', () => {
    expect(resolveSsoAdminErrorMessage(httpError('SSO configuration not found', 404), 'Failed to delete'))
      .toBe('SSO configuration not found')
    expect(resolveSsoAdminErrorMessage(httpError('An SSO configuration already exists for this organization', 409), 'Failed'))
      .toBe('An SSO configuration already exists for this organization')
  })

  it('resolves trimmed messages', () => {
    expect(resolveSsoAdminErrorMessage(new Error('  Denied  '), 'fallback')).toBe('Denied')
    expect(resolveSsoAdminErrorMessage(null, 'fallback')).toBe('fallback')
  })
})
