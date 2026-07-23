import {
  reconcileGatewayConnections,
  type GatewayConnectionEntry,
} from '../discord-gateway'
import type { DiscordGatewayHandle } from '../../lib/discord-gateway-client'

function fakeEntry(tenantId: string): { entry: GatewayConnectionEntry; close: jest.Mock } {
  const close = jest.fn()
  const handle: DiscordGatewayHandle = { close }
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
