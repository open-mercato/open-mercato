import { reviveSnapshotDates } from '@open-mercato/shared/lib/commands/undo'
import type { CustomerInteraction } from '../data/entities'

/**
 * Interaction columns a Person/Company delete snapshot must carry so that undo can recreate each interaction
 * exactly as it was. Every key is optional because delete logs written before these columns were captured
 * do not contain them.
 */
export type InteractionRestoreDetails = {
  externalMessageId?: string | null
  channelProviderKey?: string | null
  channelId?: string | null
  durationMinutes?: number | null
  location?: string | null
  allDay?: boolean | null
  recurrenceRule?: string | null
  recurrenceEnd?: Date | string | null
  participants?: CustomerInteraction['participants']
  reminderMinutes?: number | null
  visibility?: string | null
  linkedEntities?: CustomerInteraction['linkedEntities']
  guestPermissions?: CustomerInteraction['guestPermissions']
  pinned?: boolean
}

const INTERACTION_RESTORE_DETAIL_KEYS = [
  'externalMessageId',
  'channelProviderKey',
  'channelId',
  'durationMinutes',
  'location',
  'allDay',
  'recurrenceRule',
  'recurrenceEnd',
  'participants',
  'reminderMinutes',
  'visibility',
  'linkedEntities',
  'guestPermissions',
  'pinned',
] as const satisfies ReadonlyArray<keyof InteractionRestoreDetails>

export function captureInteractionRestoreDetails(interaction: CustomerInteraction): Required<InteractionRestoreDetails> {
  return {
    externalMessageId: interaction.externalMessageId ?? null,
    channelProviderKey: interaction.channelProviderKey ?? null,
    channelId: interaction.channelId ?? null,
    durationMinutes: interaction.durationMinutes ?? null,
    location: interaction.location ?? null,
    allDay: interaction.allDay ?? null,
    recurrenceRule: interaction.recurrenceRule ?? null,
    recurrenceEnd: interaction.recurrenceEnd ?? null,
    participants: interaction.participants ?? null,
    reminderMinutes: interaction.reminderMinutes ?? null,
    visibility: interaction.visibility ?? null,
    linkedEntities: interaction.linkedEntities ?? null,
    guestPermissions: interaction.guestPermissions ?? null,
    pinned: interaction.pinned === true,
  }
}

/**
 * A delete log written before visibility was captured cannot tell whether an email was private. An email that
 * has an author is restored private: its author still reads it and can share it again. An email without an
 * author keeps the previous behaviour, because a private row without an author is readable and changeable by
 * nobody.
 */
function resolveRestoredVisibility(snapshot: { interactionType: string; authorUserId: string | null } & InteractionRestoreDetails): string | null {
  if (Object.prototype.hasOwnProperty.call(snapshot, 'visibility')) return snapshot.visibility ?? null
  return snapshot.interactionType === 'email' && snapshot.authorUserId ? 'private' : null
}

export function restoreInteractionRestoreDetails(
  snapshot: { interactionType: string; authorUserId: string | null } & InteractionRestoreDetails,
) {
  const { recurrenceEnd } = reviveSnapshotDates({ recurrenceEnd: snapshot.recurrenceEnd ?? null }, ['recurrenceEnd'])
  return {
    externalMessageId: snapshot.externalMessageId ?? null,
    channelProviderKey: snapshot.channelProviderKey ?? null,
    channelId: snapshot.channelId ?? null,
    durationMinutes: snapshot.durationMinutes ?? null,
    location: snapshot.location ?? null,
    allDay: snapshot.allDay ?? null,
    recurrenceRule: snapshot.recurrenceRule ?? null,
    recurrenceEnd: recurrenceEnd as Date | null,
    participants: snapshot.participants ?? null,
    reminderMinutes: snapshot.reminderMinutes ?? null,
    visibility: resolveRestoredVisibility(snapshot),
    linkedEntities: snapshot.linkedEntities ?? null,
    guestPermissions: snapshot.guestPermissions ?? null,
    pinned: snapshot.pinned === true,
  }
}

/**
 * The delete log's `snapshotBefore` is what the audit log shows; the restore details stay in the undo payload only.
 */
export function omitInteractionRestoreDetails<TSnapshot extends { interactions?: ReadonlyArray<InteractionRestoreDetails> }>(
  snapshot: TSnapshot,
): TSnapshot {
  if (!Array.isArray(snapshot.interactions)) return snapshot
  return {
    ...snapshot,
    interactions: snapshot.interactions.map((interaction) => {
      const visible: Record<string, unknown> = { ...interaction }
      for (const key of INTERACTION_RESTORE_DETAIL_KEYS) delete visible[key]
      return visible
    }),
  }
}
