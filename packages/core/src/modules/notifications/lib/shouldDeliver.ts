import { createLogger } from '@open-mercato/shared/lib/logger'
import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import type { NotificationPreferenceScope } from './notificationPreferenceService'

const logger = createLogger('notifications').child({ component: 'delivery-gate' })

// One warning per unregistered type id per process — unregistered ids are rare (a renamed/removed type
// still referenced by an in-flight notification), so the set stays tiny and the log never floods.
const warnedUnregisteredTypes = new Set<string>()

/**
 * The single per-channel delivery gate. Every channel (`in_app`, `email`, `push`, custom) is
 * governed by this one function so opt-out / eligibility / targeting enforcement can never be
 * bypassed or re-implemented inconsistently per strategy.
 *
 * A channel is delivered when ALL hold:
 *   1. it is a registered strategy id (`registeredChannels`),
 *   2. the type is eligible for it — the operator's stored override
 *      (`notification_types.channels`, when set) or the code-declared `type.channels`;
 *      this runs BEFORE the `nonOptOut` bypass and before user preferences, so a channel
 *      outside the effective set is completely off for the type,
 *   3. it is in the per-send target (`targetChannels`, when provided),
 *   4. either the type is effectively `nonOptOut` (operator override ?? code flag), or the
 *      recipient has not disabled it (`isChannelEnabled`).
 *
 * `silent` is intentionally NOT consulted here — it selects push delivery STYLE, not whether a
 * channel delivers at all. Absent `type.channels` and absent `targetChannels` both mean "no
 * restriction", so a fully-default call resolves to every registered channel (pre-Phase-7 behavior).
 */
export type ChannelPreferenceReader = {
  isChannelEnabled(scope: NotificationPreferenceScope, typeId: string, channel: string): Promise<boolean>
}

/**
 * The effective eligibility set for a type: the operator's stored override replaces the
 * code-declared `type.channels`; `null`/absent on both ⇒ no restriction (every channel).
 */
export function resolveEligibleChannels(
  type: NotificationTypeDefinition | undefined,
  channelsOverride: string[] | null | undefined,
): string[] | null {
  return channelsOverride ?? type?.channels ?? null
}

export type ShouldDeliverParams = {
  /** The notification's `type` string (used for the preference lookup even when unregistered). */
  typeId: string
  /** The registered type definition, when the type id is known. Supplies eligibility + nonOptOut. */
  type: NotificationTypeDefinition | undefined
  channel: string
  scope: NotificationPreferenceScope
  /** Per-send channel target. `null`/`undefined` → no target restriction. */
  targetChannels?: string[] | null
  /** Ids of the currently registered delivery strategies. */
  registeredChannels: string[]
  preferences: ChannelPreferenceReader
  /**
   * Operator override of the type's eligibility from `notification_types.channels`.
   * `undefined`/`null` ⇒ no override; the code-declared `type.channels` applies.
   */
  channelsOverride?: string[] | null
  /**
   * Operator override of the type's `nonOptOut` flag from `notification_types.non_opt_out`.
   * `undefined`/`null` ⇒ no override; the code-declared flag applies.
   */
  nonOptOutOverride?: boolean | null
}

export async function shouldDeliver(params: ShouldDeliverParams): Promise<boolean> {
  const {
    typeId, type, channel, scope, targetChannels, registeredChannels, preferences,
    channelsOverride, nonOptOutOverride,
  } = params

  if (!registeredChannels.includes(channel)) return false
  const eligible = resolveEligibleChannels(type, channelsOverride)
  if (eligible && !eligible.includes(channel)) return false
  if (targetChannels && !targetChannels.includes(channel)) return false
  if ((nonOptOutOverride ?? type?.nonOptOut) === true) return true

  // The type id resolved to no registered definition (renamed/removed type), so its code-declared
  // `nonOptOut` and eligibility cannot be enforced here — a security type that was `nonOptOut` becomes
  // silently user-suppressible. Surface that once so it is not invisible (there is no operator override
  // in play either, else the branch above would have returned).
  if (!type && nonOptOutOverride == null && !warnedUnregisteredTypes.has(typeId)) {
    warnedUnregisteredTypes.add(typeId)
    logger.warn(
      'Delivery gate evaluated an unregistered notification type; its code-declared nonOptOut/eligibility cannot be enforced and it is subject to user opt-out',
      { typeId },
    )
  }

  return preferences.isChannelEnabled(scope, typeId, channel)
}

export type ResolveEffectiveChannelsParams = Omit<ShouldDeliverParams, 'channel'>

/**
 * Resolves the authoritative channel set for a notification at create time: every registered
 * channel that passes {@link shouldDeliver}. Stored on `Notification.channels` and looped by the
 * dispatcher; `in_app` membership also gates bell/inbox visibility.
 */
export async function resolveEffectiveChannels(
  params: ResolveEffectiveChannelsParams,
): Promise<string[]> {
  const results = await Promise.all(
    params.registeredChannels.map(async (channel) =>
      (await shouldDeliver({ ...params, channel })) ? channel : null,
    ),
  )
  return results.filter((channel): channel is string => channel !== null)
}
