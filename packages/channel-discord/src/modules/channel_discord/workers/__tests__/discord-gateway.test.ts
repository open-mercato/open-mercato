import {
  buildGatewayChannelFilter,
  isConnectionLive,
  reconcileGatewayConnections,
  type GatewayConnectionEntry,
} from '../discord-gateway'
import type { DiscordGatewayHandle } from '../../lib/discord-gateway-client'

function fakeEntry(
  tenantId: string,
  active = true,
  organizationId: string | null = null,
): { entry: GatewayConnectionEntry; close: jest.Mock } {
  const close = jest.fn()
  const handle: DiscordGatewayHandle = { close, isActive: () => active }
  return { entry: { handle, tenantId, organizationId }, close }
}

/**
 * `GatewayJobPayload.organizationId` used to be accepted and silently discarded:
 * the query filtered on tenant only, so a job scoped to one organization
 * connected every organization in the tenant. A scope parameter that is declared
 * and then thrown away is how multi-tenant defects start, so the filter is
 * pinned here.
 */
describe('buildGatewayChannelFilter (scoped job payloads)', () => {
  it('connects every active discord channel when the payload carries no scope', () => {
    expect(buildGatewayChannelFilter({})).toEqual({
      providerKey: 'discord',
      isActive: true,
      deletedAt: null,
    })
  })

  it('narrows by tenant when the payload names one', () => {
    expect(buildGatewayChannelFilter({ tenantId: 't1' })).toEqual({
      providerKey: 'discord',
      isActive: true,
      deletedAt: null,
      tenantId: 't1',
    })
  })

  it('narrows by organization when the payload names one', () => {
    expect(buildGatewayChannelFilter({ tenantId: 't1', organizationId: 'org-a' })).toEqual({
      providerKey: 'discord',
      isActive: true,
      deletedAt: null,
      tenantId: 't1',
      organizationId: 'org-a',
    })
  })

  it('treats an explicitly null organization as "no organization filter", not "tenant-wide channels only"', () => {
    // The payload type allows `organizationId: null`; that is the absence of a
    // filter, not a request for rows whose organization_id IS NULL.
    expect(buildGatewayChannelFilter({ tenantId: 't1', organizationId: null })).toEqual({
      providerKey: 'discord',
      isActive: true,
      deletedAt: null,
      tenantId: 't1',
    })
  })
})

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
    const removed = reconcileGatewayConnections(new Set<string>(), connections, { tenantId: 't1' })

    expect(removed).toEqual(['chan-t1'])
    expect(t1.close).toHaveBeenCalledTimes(1)
    expect(t2.close).not.toHaveBeenCalled()
    expect(connections.has('chan-t2')).toBe(true)
  })

  it('an organization-scoped refresh never tears down a sibling organization’s sockets', () => {
    // A job payload carrying `organizationId` used to be accepted and discarded:
    // the query and the reconciliation both filtered on tenant only, so a refresh
    // scoped to one organization would close every OTHER organization's sockets
    // in the same tenant, because none of their channels appeared in the
    // (tenant-wide) active set it compared against.
    const orgA = fakeEntry('t1', true, 'org-a')
    const orgB = fakeEntry('t1', true, 'org-b')
    const tenantWide = fakeEntry('t1', true, null)
    const connections = new Map<string, GatewayConnectionEntry>([
      ['chan-org-a', orgA.entry],
      ['chan-org-b', orgB.entry],
      ['chan-tenant-wide', tenantWide.entry],
    ])

    const removed = reconcileGatewayConnections(new Set<string>(), connections, {
      tenantId: 't1',
      organizationId: 'org-a',
    })

    expect(removed).toEqual(['chan-org-a'])
    expect(orgA.close).toHaveBeenCalledTimes(1)
    expect(orgB.close).not.toHaveBeenCalled()
    expect(tenantWide.close).not.toHaveBeenCalled()
    expect(connections.has('chan-org-b')).toBe(true)
    expect(connections.has('chan-tenant-wide')).toBe(true)
  })

  it('an unscoped refresh still reconciles every tenant and organization', () => {
    const orgA = fakeEntry('t1', true, 'org-a')
    const otherTenant = fakeEntry('t2', true, 'org-z')
    const connections = new Map<string, GatewayConnectionEntry>([
      ['chan-org-a', orgA.entry],
      ['chan-t2', otherTenant.entry],
    ])

    const removed = reconcileGatewayConnections(new Set<string>(), connections)

    expect(removed.sort()).toEqual(['chan-org-a', 'chan-t2'])
    expect(connections.size).toBe(0)
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
      organizationId: null,
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
