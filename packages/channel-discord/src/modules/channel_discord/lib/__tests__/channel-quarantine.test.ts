import { quarantineDiscordChannel } from '../channel-state-store'
import { buildGatewayChannelFilter } from '../../workers/discord-gateway'

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
type FakeChannel = { status: string; lastError: string | null; isActive: boolean }

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
    const channel: FakeChannel = { status: 'connected', lastError: null, isActive: true }
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

  it('flips isActive to false so the admin list stops reporting the channel as Active', async () => {
    // Regression: the reconciler already skipped `status === 'requires_reauth'`,
    // but the admin channels list (`backend/communication_channels/channels/page.tsx`)
    // renders its Active/Inactive badge from `isActive`, not `status` — so a
    // quarantined channel kept showing Active until this flipped too.
    const channel: FakeChannel = { status: 'connected', lastError: null, isActive: true }
    const { em } = fakeEm(channel)

    await quarantineDiscordChannel({
      em: em as never,
      channelId: 'chan-1',
      scope: SCOPE,
      reason: 'gateway_close_4004',
    })

    expect(channel.isActive).toBe(false)
  })

  it('makes the quarantined row drop out of the reconciler’s next-tick query filter', async () => {
    // `buildGatewayChannelFilter` is what the reconciler runs on every refresh
    // tick to decide which channels to (re)connect. It filters on `isActive:
    // true`, so once quarantine flips that flag, the same channel row that
    // caused 16 fatal closes over 10 ticks (see #4979) no longer matches on
    // the next tick — no persisted `status` lookup is even needed to skip it.
    const channel: FakeChannel & { providerKey: string; deletedAt: null } = {
      status: 'connected',
      lastError: null,
      isActive: true,
      providerKey: 'discord',
      deletedAt: null,
    }
    const { em } = fakeEm(channel)

    await quarantineDiscordChannel({
      em: em as never,
      channelId: 'chan-1',
      scope: SCOPE,
      reason: 'gateway_close_4014',
    })

    const nextTickFilter = buildGatewayChannelFilter({})
    expect(channel.isActive).not.toBe(nextTickFilter.isActive)
  })

  it('looks the channel up inside its own tenant scope, never by id alone', async () => {
    fakeEm({ status: 'connected', lastError: null, isActive: true })

    await quarantineDiscordChannel({
      em: (fakeEm({ status: 'connected', lastError: null, isActive: true }).em) as never,
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
