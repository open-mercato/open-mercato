import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { detectLocale, loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { resolveSupportedLocale } from '@open-mercato/shared/lib/i18n/locale'
import { resolveLocaleFromRequest } from '../../translations/lib/locale'
import { NotificationType, NotificationTypeOverride } from '../data/entities'
import { getNotificationDeliveryStrategies } from './deliveryStrategies'
import { getNotificationType } from './notification-type-registry'

const CATEGORY_LABEL_KEY_PREFIX = 'notifications.categories.'

export type CatalogueTranslate = (key: string, fallback: string) => string

/**
 * Locale for the display strings, following the repo-wide request-locale convention
 * (`resolveLocaleFromRequest`: `?locale=` → `x-locale` → cookie → `Accept-Language`).
 * Only the `Accept-Language` branch of that helper validates its input, so the result is
 * re-checked against the supported set here — an unsupported `?locale=zz` would otherwise
 * load an empty dictionary instead of degrading. Falls back to ambient detection, which
 * also honours `OM_FORCE_LOCALE`.
 */
export async function resolveCatalogueTranslate(req: Request): Promise<CatalogueTranslate> {
  const requested = resolveSupportedLocale(resolveLocaleFromRequest(req))
  const locale = requested ?? (await detectLocale())
  return createFallbackTranslator(await loadDictionary(locale))
}

/**
 * Catalogue item with the caller tenant's stored overrides merged in — matching
 * `resolveEligibleChannels` in the delivery gate, so preference UIs lock exactly the cells
 * delivery would reject. `channels: null` = no restriction (every registered channel).
 * `updatedAt` is the override row's version token for optimistic locking (`null` when the
 * tenant stores no override yet).
 *
 * `label` / `description` / `categoryLabel` are resolved server-side so clients without the
 * Open Mercato dictionary (the mobile app) can render the screen directly. Group on
 * `category` — the raw key, stable across locales — and display `categoryLabel`; grouping on
 * the localized string re-partitions the list whenever the language changes.
 *
 * A category whose owning module ships no `notifications.categories.<key>` entry falls back
 * to the raw key, so `categoryLabel === category` signals to a client that no server-side
 * translation exists and it may apply its own presentation.
 */
export const typeItem = (
  row: NotificationType,
  override: NotificationTypeOverride | null | undefined,
  translate: CatalogueTranslate,
) => ({
  id: row.id,
  labelKey: row.labelKey,
  descriptionKey: row.descriptionKey ?? null,
  category: row.category ?? null,
  categoryLabel: row.category
    ? translate(`${CATEGORY_LABEL_KEY_PREFIX}${row.category}`, row.category)
    : null,
  label: row.labelKey ? translate(row.labelKey, row.id) : null,
  description: row.descriptionKey ? translate(row.descriptionKey, '') : null,
  silent: row.silent === true,
  nonOptOut: (override?.nonOptOut ?? row.nonOptOut) === true,
  channels: override?.channels ?? getNotificationType(row.id)?.channels ?? null,
  storedChannels: override?.channels ?? null,
  storedNonOptOut: override?.nonOptOut ?? null,
  updatedAt: override?.updatedAt ? override.updatedAt.toISOString() : null,
})

/** Ids of every registered delivery channel (`in_app`, `email`, `push`, …). */
export function resolveRegisteredChannelIds(): string[] {
  return getNotificationDeliveryStrategies().map((strategy) => strategy.id)
}

/**
 * The channel set a per-channel toggle applies to, resolved server-side so a client never
 * has to send a whole replacing array. Mirrors what the catalogue exposes as the effective
 * set — stored override, else the code declaration, else every registered channel (the
 * `channels: null` "no restriction" case, which a toggle has to materialize before it can
 * remove one entry from it).
 */
export function resolveEffectiveChannels(
  typeId: string,
  storedChannels: string[] | null | undefined,
  registeredChannelIds: string[],
): string[] {
  return storedChannels ?? getNotificationType(typeId)?.channels ?? registeredChannelIds
}

/**
 * Load the tenant's override row for a type under a row lock, so a read-modify-write of the
 * `channels` array serializes against a concurrent one instead of last-write-wins. Returns
 * `null` when no override is stored yet (nothing exists to lock — that first-write race is
 * caught by the partial unique index instead).
 */
export function loadTypeOverrideForUpdate(
  em: EntityManager,
  tenantId: string,
  notificationTypeId: string,
): Promise<NotificationTypeOverride | null> {
  return em.findOne(
    NotificationTypeOverride,
    { tenantId, notificationTypeId },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
  )
}

/**
 * Apply the resolved override values to the tenant's row, creating, updating or dropping it.
 * Shared by the full-array `PATCH` and the per-channel add/remove sub-resource so both agree
 * on the "all overrides cleared ⇒ remove the row" rule. Does NOT flush — the caller owns the
 * transaction boundary and the unique-violation handling.
 */
export function applyTypeOverride(
  em: EntityManager,
  input: {
    tenantId: string
    notificationTypeId: string
    existing: NotificationTypeOverride | null
    nextChannels: string[] | null
    nextNonOptOut: boolean | null
  },
): NotificationTypeOverride | null {
  const { tenantId, notificationTypeId, existing, nextChannels, nextNonOptOut } = input
  if (nextChannels === null && nextNonOptOut === null) {
    // Both overrides cleared ⇒ the code declarations apply again; drop the row
    // instead of keeping an all-null husk.
    if (existing) em.remove(existing)
    return null
  }
  if (existing) {
    existing.channels = nextChannels
    existing.nonOptOut = nextNonOptOut
    return existing
  }
  const created = em.create(NotificationTypeOverride, {
    tenantId,
    notificationTypeId,
    channels: nextChannels,
    nonOptOut: nextNonOptOut,
  })
  em.persist(created)
  return created
}
