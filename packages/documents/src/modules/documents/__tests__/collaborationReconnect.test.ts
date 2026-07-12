import {
  classifyCollabTokenResponse,
  COLLABORATION_OFFLINE_AFTER_MS,
  COLLABORATION_PROVIDER_RETRY,
  COLLABORATION_RECONNECT_GRACE_MS,
  createCollaborationStatusController,
  fetchCollabTokenAttempt,
} from '../backend/documents/[id]/useDocumentCollaboration'

const VALID_TOKEN = {
  token: 'signed-token',
  url: 'ws://localhost:4141',
  documentId: '22222222-2222-4222-8222-222222222222',
  tier: 'editor',
  expiresInSec: 60,
  canEdit: true,
  readOnly: false,
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Readable collaborator',
    color: '#123456',
  },
}

describe('collaboration reconnect behavior', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('keeps Live during a fast rollover, then stages reconnecting and offline', () => {
    const statuses: string[] = []
    const controller = createCollaborationStatusController({
      onStatus: (status) => statuses.push(status),
    })

    controller.synced()
    controller.disconnected()
    expect(statuses).toEqual(['connected'])

    jest.advanceTimersByTime(COLLABORATION_RECONNECT_GRACE_MS - 1)
    expect(statuses).toEqual(['connected'])
    jest.advanceTimersByTime(1)
    expect(statuses).toEqual(['connected', 'reconnecting'])

    jest.advanceTimersByTime(
      COLLABORATION_OFFLINE_AFTER_MS - COLLABORATION_RECONNECT_GRACE_MS,
    )
    expect(statuses).toEqual(['connected', 'reconnecting', 'offline'])

    controller.disconnected()
    jest.advanceTimersByTime(COLLABORATION_OFFLINE_AFTER_MS)
    expect(statuses).toEqual(['connected', 'reconnecting', 'offline'])
  })

  it('cancels staged outage changes on recovery and on disposal', () => {
    const statuses: string[] = []
    const controller = createCollaborationStatusController({
      onStatus: (status) => statuses.push(status),
    })

    controller.synced()
    controller.disconnected()
    jest.advanceTimersByTime(COLLABORATION_RECONNECT_GRACE_MS - 1)
    controller.synced()
    jest.advanceTimersByTime(COLLABORATION_OFFLINE_AFTER_MS)
    expect(statuses).toEqual(['connected', 'connected'])

    controller.disconnected()
    controller.dispose()
    jest.advanceTimersByTime(COLLABORATION_OFFLINE_AFTER_MS)
    expect(statuses).toEqual(['connected', 'connected'])
  })

  it('does not restart outage timers for duplicate transport events', () => {
    const statuses: string[] = []
    const controller = createCollaborationStatusController({
      onStatus: (status) => statuses.push(status),
    })

    controller.synced()
    controller.disconnected()
    jest.advanceTimersByTime(COLLABORATION_RECONNECT_GRACE_MS - 1)
    controller.disconnected()
    jest.advanceTimersByTime(1)
    expect(statuses).toEqual(['connected', 'reconnecting'])
  })

  it('uses fast bounded retries without limiting genuine network recovery', () => {
    expect(COLLABORATION_PROVIDER_RETRY.delay).toBeLessThanOrEqual(250)
    expect(COLLABORATION_PROVIDER_RETRY.maxDelay).toBeLessThanOrEqual(2000)
    expect(COLLABORATION_PROVIDER_RETRY.maxAttempts).toBe(0)
  })

  it('distinguishes retryable token failures from definitive rejection', () => {
    expect(classifyCollabTokenResponse(
      { ok: false, status: 503, result: null },
      'Unknown user',
    )).toEqual({ kind: 'transient' })
    expect(classifyCollabTokenResponse(
      { ok: false, status: 429, result: null },
      'Unknown user',
    )).toEqual({ kind: 'transient' })
    expect(classifyCollabTokenResponse(
      { ok: false, status: 403, result: null },
      'Unknown user',
    )).toEqual({ kind: 'fatal' })
    expect(classifyCollabTokenResponse(
      { ok: true, status: 200, result: { malformed: true } },
      'Unknown user',
    )).toEqual({ kind: 'fatal' })
    expect(classifyCollabTokenResponse(
      { ok: true, status: 200, result: VALID_TOKEN },
      'Unknown user',
    )).toMatchObject({ kind: 'ok', token: { token: 'signed-token' } })
  })

  it('suppresses redirect throwing so a real forbidden refresh is fatal', async () => {
    const call = jest.fn(async () => ({ ok: false, status: 403, result: null }))

    await expect(fetchCollabTokenAttempt(
      '22222222-2222-4222-8222-222222222222',
      'Unknown user',
      call,
    )).resolves.toEqual({ kind: 'fatal' })
    expect(call).toHaveBeenCalledWith(
      '/api/documents/22222222-2222-4222-8222-222222222222/collab-token',
      expect.objectContaining({
        headers: {
          'x-om-forbidden-redirect': '0',
          'x-om-unauthorized-redirect': '0',
        },
      }),
    )
  })
})
