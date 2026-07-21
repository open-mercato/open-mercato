import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { NotificationPreference } from '../data/entities'
import { getNotificationType } from './notification-type-registry'
import { getNotificationTypeOverrides } from './typeOverrides'

/**
 * Tenant + user scope for preference operations. Tenant scoping is mandatory,
 * so it is part of every call (the spec's bare `userId` signatures are widened
 * here to stay tenant-safe).
 */
export interface NotificationPreferenceScope {
  tenantId: string
  userId: string
}

export interface NotificationPreferenceInput {
  typeId: string
  channel: string
  enabled: boolean
}

export interface NotificationPreferenceService {
  /**
   * Whether a channel is enabled for a user + type. Defaults to `true` when no
   * row exists (lazy-seed, default-on) — does not write.
   */
  isChannelEnabled(scope: NotificationPreferenceScope, typeId: string, channel: string): Promise<boolean>
  /**
   * Bulk find-or-upsert of preference rows for the scoped user. Returns the number of rows actually
   * changed (created, or whose `enabled` flipped) so callers can skip emitting events on no-op writes.
   */
  setPreferences(scope: NotificationPreferenceScope, items: NotificationPreferenceInput[]): Promise<number>
  /** All stored preference rows for the scoped user (absence ⇒ enabled). */
  listForUser(scope: NotificationPreferenceScope): Promise<NotificationPreference[]>
}

export interface NotificationPreferenceServiceDeps {
  em: EntityManager
}

export function createNotificationPreferenceService(
  deps: NotificationPreferenceServiceDeps,
): NotificationPreferenceService {
  const { em: rootEm } = deps

  return {
    async isChannelEnabled(scope, typeId, channel) {
      const row = await rootEm.findOne(NotificationPreference, {
        tenantId: scope.tenantId,
        userId: scope.userId,
        notificationTypeId: typeId,
        channel,
      })
      return row ? row.enabled : true
    },

    async listForUser(scope) {
      return rootEm.find(
        NotificationPreference,
        { tenantId: scope.tenantId, userId: scope.userId },
        { orderBy: { notificationTypeId: 'asc', channel: 'asc' } },
      )
    },

    async setPreferences(scope, items) {
      const storedOverrides = items.length
        ? await getNotificationTypeOverrides(rootEm.fork(), scope.tenantId, items.map((item) => item.typeId))
        : new Map()
      // Effectively-nonOptOut types (operator override ?? code flag) ignore stored preferences at
      // delivery time; refuse to persist an opt-out row for them so the stored state can never
      // contradict enforcement. An `enabled: true` write matches the forced-on state and is
      // allowed through (a preferences UI can still confirm it).
      const optOutFiltered = items.filter((item) => {
        if (item.enabled === true) return true
        const nonOptOut =
          storedOverrides.get(item.typeId)?.nonOptOut ?? getNotificationType(item.typeId)?.nonOptOut
        return nonOptOut !== true
      })
      // Channels outside the type's effective eligibility (operator override on
      // `notification_types.channels`, else the code-declared `type.channels`) are locked:
      // delivery rejects them before preferences and the UI renders the cell off, so a stored
      // row would only lie. Drop those writes server-side (the UI lock is not a guarantee).
      const writable = optOutFiltered.filter((item) => {
        const eligible = storedOverrides.get(item.typeId)?.channels ?? getNotificationType(item.typeId)?.channels
        return !eligible || eligible.includes(item.channel)
      })
      if (writable.length === 0) return 0
      const em = rootEm.fork()
      const existing = await em.find(NotificationPreference, {
        tenantId: scope.tenantId,
        userId: scope.userId,
      })
      const byKey = new Map(
        existing.map((row) => [`${row.notificationTypeId}::${row.channel}`, row]),
      )

      let changed = 0
      await withAtomicFlush(
        em,
        [
          () => {
            for (const item of writable) {
              const row = byKey.get(`${item.typeId}::${item.channel}`)
              if (row) {
                if (row.enabled === item.enabled) continue
                row.enabled = item.enabled
                changed += 1
                continue
              }
              const next = em.create(NotificationPreference, {
                tenantId: scope.tenantId,
                userId: scope.userId,
                notificationTypeId: item.typeId,
                channel: item.channel,
                enabled: item.enabled,
              })
              em.persist(next)
              changed += 1
            }
          },
        ],
        { transaction: true, label: 'notifications.setPreferences' },
      )
      return changed
    },
  }
}

export function resolveNotificationPreferenceService(container: {
  resolve: (name: string) => unknown
}): NotificationPreferenceService {
  // Construct from the request-scoped `em`, mirroring `resolveNotificationService`. (The request
  // container does not expose the module's scoped service bindings, so resolving `em` directly is the
  // module convention — see notificationService.ts.)
  const em = container.resolve('em') as EntityManager
  return createNotificationPreferenceService({ em })
}
