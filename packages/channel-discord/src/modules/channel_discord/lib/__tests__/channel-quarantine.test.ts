import { quarantineDiscordChannel } from '../channel-state-store'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { findOneWithDecryption } = require('@open-mercato/shared/lib/encryption/find') as {
  findOneWithDecryption: jest.Mock
}

/**
 * Regression guard for #4979.
 *
 * A `4004` (invalid token) or `4014` (disallowed intents — the most common
 * Discord setup mistake) close is non-recoverable, but the worker only emitted
 * `communication_channels.channel.requires_reauth` and dropped the handle.
 * Nothing subscribes to that event to change channel state, so the next
 * reconciliation tick saw "no live session" and IDENTIFYed again. QA measured 16
 * fatal closes over 10 ticks at `--refresh 5`, with the row still reading
 * `is_active=t, status=connected, last_error=NULL`; at the default `--refresh 60`
 * that is ~1440 session starts per day against Discord's ~1000/day per-bot budget.
 */
type FakeChannel = { status: string; lastError: string | null }

function fakeEm(channel: FakeChannel | null): { em: unknown; flush: jest.Mock } {
  const flush = jest.fn().mockResolvedValue(undefined)
  const fork = { flush }
  findOneWithDecryption.mockResolvedValue(channel)
  return { em: { fork: () => fork }, flush }
}

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('quarantineDiscordChannel', () => {
  beforeEach(() => {
    findOneWithDecryption.mockReset()
  })

  it('parks the channel as requires_reauth with the close code as the reason', async () => {
    const channel: FakeChannel = { status: 'connected', lastError: null }
    const { em, flush } = fakeEm(channel)

    const result = await quarantineDiscordChannel({
      em: em as never,
      channelId: 'chan-1',
      scope: SCOPE,
      reason: 'gateway_close_4014',
    })

    expect(result).toBe('quarantined')
    expect(channel.status).toBe('requires_reauth')
    expect(channel.lastError).toBe('gateway_close_4014')
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('looks the channel up inside its own tenant scope, never by id alone', async () => {
    fakeEm({ status: 'connected', lastError: null })

    await quarantineDiscordChannel({
      em: (fakeEm({ status: 'connected', lastError: null }).em) as never,
      channelId: 'chan-1',
      scope: SCOPE,
      reason: 'gateway_close_4004',
    })

    const filter = findOneWithDecryption.mock.calls.at(-1)?.[2]
    expect(filter).toMatchObject({
      id: 'chan-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      deletedAt: null,
    })
  })

  it('reports not_found instead of throwing when the row is outside the scope', async () => {
    const { em, flush } = fakeEm(null)

    const result = await quarantineDiscordChannel({
      em: em as never,
      channelId: 'chan-gone',
      scope: SCOPE,
      reason: 'gateway_close_4004',
    })

    expect(result).toBe('not_found')
    expect(flush).not.toHaveBeenCalled()
  })
})
