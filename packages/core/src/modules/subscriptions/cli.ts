import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Subscription } from './data/entities'

function parseArgs(rest: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = rest[index + 1]
    if (!next || next.startsWith('--')) {
      out[key] = 'true'
    } else {
      out[key] = next
      index += 1
    }
  }
  return out
}

function buildAuth(tenantId: string, organizationId: string): AuthContext {
  return {
    sub: 'cli',
    tenantId,
    orgId: organizationId,
    roles: ['superadmin'],
    isSuperAdmin: true,
  } as AuthContext
}

const syncPlans: ModuleCli = {
  command: 'sync-plans',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
    const manifestPath = typeof args.manifest === 'string' ? args.manifest : undefined
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato subscriptions sync-plans --tenant <tenantId> --org <organizationId> [--manifest <path>]')
      return
    }
    const container = await createRequestContainer()
    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute('subscriptions.plans.sync', {
      input: manifestPath ? { manifestPath } : {},
      ctx: {
        container,
        auth: buildAuth(tenantId, organizationId),
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: [organizationId],
      },
    })
    console.log('subscriptions: plans synced', result)
  },
}

const reconcile: ModuleCli = {
  command: 'reconcile',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
    const subscriptionId = typeof args.id === 'string' ? args.id : null
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato subscriptions reconcile --tenant <tenantId> --org <organizationId> [--id <subscriptionId> | --all]')
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const commandBus = container.resolve('commandBus') as CommandBus
    const candidates = subscriptionId
      ? await findWithDecryption(
        em,
        Subscription,
        { id: subscriptionId, tenantId, organizationId, deletedAt: null },
        undefined,
        { tenantId, organizationId },
      )
      : await findWithDecryption(
        em,
        Subscription,
        { tenantId, organizationId, deletedAt: null },
        { limit: 500 },
        { tenantId, organizationId },
      )
    let changed = 0
    for (const sub of candidates) {
      try {
        const { result } = await commandBus.execute('subscriptions.subscription.refresh', {
          input: { subscriptionId: sub.id },
          ctx: {
            container,
            auth: buildAuth(tenantId, organizationId),
            organizationScope: null,
            selectedOrganizationId: organizationId,
            organizationIds: [organizationId],
          },
        })
        if ((result as { changed?: boolean }).changed) changed += 1
      } catch (error) {
        console.warn('[subscriptions.cli.reconcile] failed', sub.id, error)
      }
    }
    console.log(`subscriptions: reconciled ${candidates.length} subscriptions (${changed} changed)`)
  },
}

const cancel: ModuleCli = {
  command: 'cancel',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
    const subscriptionId = typeof args.id === 'string' ? args.id : ''
    if (!tenantId || !organizationId || !subscriptionId) {
      console.error('Usage: mercato subscriptions cancel --tenant <tenantId> --org <organizationId> --id <subscriptionId> [--immediately]')
      return
    }
    const atPeriodEnd = !args.immediately
    const container = await createRequestContainer()
    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute('subscriptions.subscription.cancel', {
      input: { subscriptionId, atPeriodEnd },
      ctx: {
        container,
        auth: buildAuth(tenantId, organizationId),
        organizationScope: null,
        selectedOrganizationId: organizationId,
        organizationIds: [organizationId],
      },
    })
    console.log('subscriptions: cancelled', result)
  },
}

const listStale: ModuleCli = {
  command: 'list-stale',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
    const olderThanMinutes = Number.parseInt(String(args.olderThanMinutes ?? '60'), 10) || 60
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato subscriptions list-stale --tenant <tenantId> --org <organizationId> [--olderThanMinutes <n>]')
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const threshold = new Date(Date.now() - olderThanMinutes * 60 * 1000)
    const stale = await findWithDecryption(
      em,
      Subscription,
      {
        tenantId,
        organizationId,
        deletedAt: null,
        updatedAt: { $lt: threshold },
      },
      { limit: 500 },
      { tenantId, organizationId },
    )
    console.log(`subscriptions: ${stale.length} stale entries (older than ${olderThanMinutes}m)`)
    for (const sub of stale) {
      console.log(`  ${sub.id} ${sub.externalAccountId} ${sub.accessState} updatedAt=${sub.updatedAt?.toISOString()}`)
    }
  },
}

const subscriptionsCli = [syncPlans, reconcile, cancel, listStale]
export default subscriptionsCli
