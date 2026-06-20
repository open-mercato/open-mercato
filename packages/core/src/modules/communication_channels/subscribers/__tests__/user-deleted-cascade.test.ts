import handler, { metadata } from '../user-deleted-cascade'

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ch-1',
    userId: 'user-1',
    status: 'connected',
    isActive: true,
    isPrimary: true,
    credentialsRef: 'cred-1',
    lastError: null,
    lastPolledAt: null,
    ...overrides,
  }
}

function makeCtx(em: { find: jest.Mock; flush: jest.Mock }) {
  return {
    resolve: <T>(name: string): T => {
      if (name === 'em') return { fork: () => em } as unknown as T
      return null as unknown as T
    },
  }
}

describe('user-deleted-cascade subscriber metadata', () => {
  it('subscribes to auth.user.deleted with a stable id', () => {
    expect(metadata.event).toBe('auth.user.deleted')
    expect(metadata.persistent).toBe(true)
    expect(metadata.id).toBe('communication_channels:user-deleted-cascade')
  })
})

describe('user-deleted-cascade subscriber behaviour', () => {
  it('no-ops when payload is missing userId', async () => {
    const find = jest.fn()
    const flush = jest.fn()
    await handler({} as never, makeCtx({ find, flush }))
    expect(find).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it('no-ops (fail-closed) when payload is missing tenantId', async () => {
    const find = jest.fn()
    const flush = jest.fn()
    await handler({ userId: 'user-1' } as never, makeCtx({ find, flush }))
    expect(find).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it('no-ops when the user has no channels', async () => {
    const find = jest.fn().mockResolvedValueOnce([])
    const flush = jest.fn()
    await handler({ userId: 'user-1', tenantId: 'tenant-1' }, makeCtx({ find, flush }))
    expect(find).toHaveBeenCalledTimes(1)
    expect(flush).not.toHaveBeenCalled()
  })

  it('disconnects every channel owned by the user', async () => {
    const channelA = makeChannel({ id: 'ch-a', userId: 'user-1' })
    const channelB = makeChannel({ id: 'ch-b', userId: 'user-1', isPrimary: false })
    const find = jest.fn().mockResolvedValueOnce([channelA, channelB])
    const flush = jest.fn()
    await handler({ userId: 'user-1', tenantId: 'tenant-1' }, makeCtx({ find, flush }))
    expect(flush).toHaveBeenCalledTimes(1)
    for (const ch of [channelA, channelB]) {
      expect(ch.status).toBe('disconnected')
      expect(ch.isActive).toBe(false)
      expect(ch.isPrimary).toBe(false)
      expect(ch.credentialsRef).toBeNull()
      expect(ch.lastError).toBe('user-deleted')
      expect(ch.lastPolledAt).toBeInstanceOf(Date)
    }
  })

  it('is idempotent — already-disconnected channels are not re-flushed', async () => {
    const already = makeChannel({
      id: 'ch-c',
      userId: 'user-1',
      status: 'disconnected',
      isActive: false,
      isPrimary: false,
      credentialsRef: null,
    })
    const find = jest.fn().mockResolvedValueOnce([already])
    const flush = jest.fn()
    await handler({ userId: 'user-1', tenantId: 'tenant-1' }, makeCtx({ find, flush }))
    expect(flush).not.toHaveBeenCalled()
  })
})
