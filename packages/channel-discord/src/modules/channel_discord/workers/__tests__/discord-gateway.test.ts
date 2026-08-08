import {
  isConnectionLive,
  reconcileGatewayConnections,
  type GatewayConnectionEntry,
} from '../discord-gateway'
import type { DiscordGatewayHandle } from '../../lib/discord-gateway-client'

function fakeEntry(tenantId: string, active = true): { entry: GatewayConnectionEntry; close: jest.Mock } {
  const close = jest.fn()
  const handle: DiscordGatewayHandle = { close, isActive: () => active }
  return { entry: { handle, tenantId }, close }
}

describe('reconcileGatewayConnections', () => {
  it('closes + removes a connection whose channel dropped out of the active set', () => {
    const a = fakeEntry('t1')
    const b = fakeEntry('t1')
    const connections = new Map<string, GatewayConnectionEntry>([
      ['chan-a', a.entry],
      ['chan-b', b.entry],
    ])

    // chan-b is no longer active (deactivated / soft-deleted).
    const removed = reconcileGatewayConnections(new Set(['chan-a']), connections)

    expect(removed).toEqual(['chan-b'])
    expect(b.close).toHaveBeenCalledTimes(1)
    expect(a.close).not.toHaveBeenCalled()
    expect(connections.has('chan-b')).toBe(false)
    expect(connections.has('chan-a')).toBe(true)
  })

  it('keeps every connection when all channels are still active', () => {
    const a = fakeEntry('t1')
    const connections = new Map<string, GatewayConnectionEntry>([['chan-a', a.entry]])
    const removed = reconcileGatewayConnections(new Set(['chan-a']), connections)
    expect(removed).toEqual([])
    expect(a.close).not.toHaveBeenCalled()
    expect(connections.has('chan-a')).toBe(true)
  })

  it('a tenant-scoped refresh never tears down another tenant’s sockets', () => {
    const t1 = fakeEntry('t1')
    const t2 = fakeEntry('t2')
    const connections = new Map<string, GatewayConnectionEntry>([
      ['chan-t1', t1.entry],
      ['chan-t2', t2.entry],
    ])

    // Scoped refresh for t1 returns no active t1 channels, but must NOT touch t2.
    const removed = reconcileGatewayConnections(new Set<string>(), connections, 't1')

    expect(removed).toEqual(['chan-t1'])
    expect(t1.close).toHaveBeenCalledTimes(1)
    expect(t2.close).not.toHaveBeenCalled()
    expect(connections.has('chan-t2')).toBe(true)
  })
})

describe('isConnectionLive (refresh must not churn healthy sockets)', () => {
  it('reports a running session as live so the refresh job leaves it alone', () => {
    const live = fakeEntry('t1', true)
    expect(isConnectionLive(live.entry)).toBe(true)
  })

  it('reports a stopped session as dead so the refresh job replaces it', () => {
    const dead = fakeEntry('t1', false)
    expect(isConnectionLive(dead.entry)).toBe(false)
  })

  it('treats a missing entry and a throwing handle as dead', () => {
    expect(isConnectionLive(undefined)).toBe(false)
    const throwing: GatewayConnectionEntry = {
      tenantId: 't1',
      handle: {
        close: jest.fn(),
        isActive: () => {
          throw new Error('socket gone')
        },
      },
    }
    expect(isConnectionLive(throwing)).toBe(false)
  })
})
