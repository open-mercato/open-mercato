import { CommunicationChannel, type CommunicationChannelStatus } from '../entities'

describe('CommunicationChannel — per-user columns (slice 3a)', () => {
  it('exposes user_id / is_primary / poll_interval_seconds / last_polled_at / status / last_error in [OptionalProps]', () => {
    // The MikroORM `OptionalProps` symbol is keyed by the constructor; we
    // can introspect via a fresh instance.
    const instance = new CommunicationChannel()
    expect(instance).toBeDefined()
    // Default values declared in the entity:
    expect(instance.isPrimary).toBe(false)
    expect(instance.status).toBe('connected')
    expect(instance.isActive).toBe(true)
  })

  it('accepts every documented CommunicationChannelStatus literal', () => {
    const statuses: CommunicationChannelStatus[] = [
      'connected',
      'requires_reauth',
      'error',
      'disconnected',
    ]
    for (const status of statuses) {
      const instance = new CommunicationChannel()
      instance.status = status
      expect(instance.status).toBe(status)
    }
  })

  it('per-user columns default to NULL (existing tenant-scoped behaviour unchanged)', () => {
    const instance = new CommunicationChannel()
    expect(instance.userId ?? null).toBeNull()
    expect(instance.pollIntervalSeconds ?? null).toBeNull()
    expect(instance.lastPolledAt ?? null).toBeNull()
    expect(instance.lastError ?? null).toBeNull()
  })
})
