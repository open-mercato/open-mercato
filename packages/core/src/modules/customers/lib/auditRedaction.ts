import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { isEmailHiddenFrom } from './visibilityFilter'
import {
  listGrantsForViewer,
  listSharedChannelIds,
  type ConversationShareGrant,
  type ConversationShareScope,
} from './conversationShares'

const logger = createLogger('customers')

const REDACTED_INTERACTION_FIELDS: readonly string[] = ['title', 'body', 'participants', 'linkedEntities', 'custom']

export type CustomerAuditRedactionContext = {
  viewerUserId: string | null
  sharedConversations: ConversationShareGrant[]
  sharedChannelIds: string[]
}

/**
 * Resolves the widening grants for one audit-log read. Fails CLOSED on any
 * error: an empty context yields the strict owner-only redaction, never a
 * leak, so a DB hiccup here can only over-redact.
 */
export async function loadCustomerAuditRedactionContext(
  em: EntityManager,
  scope: ConversationShareScope,
  viewerUserId: string | null,
): Promise<CustomerAuditRedactionContext> {
  try {
    const [sharedConversations, sharedChannelIds] = await Promise.all([
      listGrantsForViewer(em, scope, viewerUserId),
      listSharedChannelIds(em, scope, viewerUserId),
    ])
    return { viewerUserId, sharedConversations, sharedChannelIds }
  } catch (err) {
    logger.warn('[internal] failed to resolve CRM audit redaction context; failing closed', { err })
    getTelemetryRuntime()?.reportError(err, {
      module: 'customers',
      code: 'customers.audit_redaction_context_load_failed',
    })
    return { viewerUserId, sharedConversations: [], sharedChannelIds: [] }
  }
}

function redactRecordFields(record: Record<string, unknown>): Record<string, unknown> {
  const next = { ...record }
  for (const field of REDACTED_INTERACTION_FIELDS) {
    if (field in next) next[field] = null
  }
  return next
}

function isHiddenEmailInteraction(
  interaction: { interactionType?: unknown; visibility?: unknown; authorUserId?: unknown },
  personEntityId: string | null,
  ctx: CustomerAuditRedactionContext,
): boolean {
  return isEmailHiddenFrom({
    interactionType: typeof interaction.interactionType === 'string' ? interaction.interactionType : null,
    visibility: typeof interaction.visibility === 'string' ? interaction.visibility : null,
    authorUserId: typeof interaction.authorUserId === 'string' ? interaction.authorUserId : null,
    currentUserId: ctx.viewerUserId,
    personEntityId,
    sharedConversations: ctx.sharedConversations,
    // `customers.interaction` audit snapshots never captured `channelId` (see
    // `loadInteractionSnapshot`), so a shared team mailbox cannot be proven here.
    // Fail closed rather than guess.
    channelId: null,
    sharedChannelIds: [],
  })
}

/**
 * Same predicate as {@link isHiddenEmailInteraction}, but reads straight from the
 * `InteractionSnapshot`-shaped payload (`{ interaction: {...} }`) so callers can
 * check a before/after snapshot without unpacking it first.
 */
function isInteractionSnapshotHidden(snapshot: unknown, ctx: CustomerAuditRedactionContext): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false
  const record = snapshot as Record<string, unknown>
  const interaction = record.interaction
  if (!interaction || typeof interaction !== 'object') return false
  const interactionRecord = interaction as Record<string, unknown>
  const personEntityId = typeof interactionRecord.entityId === 'string' ? interactionRecord.entityId : null
  return isHiddenEmailInteraction(interactionRecord, personEntityId, ctx)
}

/**
 * Redacts a single `InteractionSnapshot`-shaped audit payload (`{ interaction: {...}, custom: {...} }`,
 * the shape `customers.interaction` audit entries store). Mirrors the exact rule
 * {@link isEmailHiddenFrom} enforces on live CRM reads. `custom` is a sibling of
 * `interaction`, not nested inside it, so it needs its own clear alongside the
 * `redactRecordFields` pass over `interaction`.
 */
function redactInteractionSnapshot(snapshot: unknown, ctx: CustomerAuditRedactionContext): unknown {
  if (!isInteractionSnapshotHidden(snapshot, ctx)) return snapshot
  const record = snapshot as Record<string, unknown>
  const interactionRecord = record.interaction as Record<string, unknown>
  const next = { ...record, interaction: redactRecordFields(interactionRecord) }
  if ('custom' in next) next.custom = null
  return next
}

/**
 * The command bus (`packages/shared/src/lib/commands/command-bus.ts`) flattens
 * custom-field snapshot changes into top-level `cf_<name>` diff entries — a
 * canonical custom-field diff never lands under the `custom`/`interaction.custom`
 * keys `REDACTED_INTERACTION_FIELDS` names, so it needs its own check.
 */
function isCustomFieldChangeKey(key: string): boolean {
  return key.startsWith('cf_')
}

function shouldRedactChangeKey(key: string): boolean {
  if (isCustomFieldChangeKey(key)) return true
  const bareKey = key.startsWith('interaction.') ? key.slice('interaction.'.length) : key
  return isCustomFieldChangeKey(bareKey) || REDACTED_INTERACTION_FIELDS.includes(bareKey)
}

/**
 * Removes the redacted fields — content fields, their nested `interaction.*`
 * form, and canonical `cf_*` custom-field diffs — from a `changesJson` diff
 * payload so a field-level change row cannot leak content the snapshot
 * redaction already hid. Callers only invoke this once the interaction is
 * confirmed hidden from the viewer (see {@link redactCustomerAuditEntry}); an
 * authorized or non-email change history is returned untouched.
 */
function redactChanges(changes: unknown): unknown {
  if (!changes || typeof changes !== 'object') return changes
  const record = { ...(changes as Record<string, unknown>) }
  for (const key of Object.keys(record)) {
    if (shouldRedactChangeKey(key)) delete record[key]
  }
  if (record.interaction && typeof record.interaction === 'object') {
    const nested = { ...(record.interaction as Record<string, unknown>) }
    for (const key of Object.keys(nested)) {
      if (shouldRedactChangeKey(key)) delete nested[key]
    }
    record.interaction = nested
  }
  return record
}

/**
 * Delete snapshots for Person/Company strip restore-only columns (`visibility`,
 * `channelId`, ...) from `interactions[]` before storage — see
 * `commands/interactionRestoreDetails.ts:omitInteractionRestoreDetails` — so the
 * stored audit row cannot tell whether an embedded email was shared. Fail
 * closed: redact every email row whose author is not the viewer and that has
 * no matching conversation-share grant, since "unknown" must not mean "visible".
 */
function redactEmbeddedInteractions(
  snapshot: unknown,
  personEntityId: string | null,
  ctx: CustomerAuditRedactionContext,
): unknown {
  if (!snapshot || typeof snapshot !== 'object') return snapshot
  const record = snapshot as Record<string, unknown>
  const interactions = record.interactions
  if (!Array.isArray(interactions)) return snapshot

  const redacted = interactions.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    const interaction = entry as Record<string, unknown>
    if (interaction.interactionType !== 'email') return entry
    const authorUserId = typeof interaction.authorUserId === 'string' ? interaction.authorUserId : null
    if (ctx.viewerUserId && authorUserId && authorUserId === ctx.viewerUserId) return entry
    const shared = Boolean(
      personEntityId &&
        authorUserId &&
        ctx.sharedConversations.some(
          (grant) => grant.personEntityId === personEntityId && grant.ownerUserId === authorUserId,
        ),
    )
    if (shared) return entry
    return redactRecordFields(interaction)
  })
  return { ...record, interactions: redacted }
}

export type RedactableAuditEntry = {
  resourceKind?: string | null
  snapshotBefore?: unknown
  snapshotAfter?: unknown
  changesJson?: unknown
}

/**
 * Applies the CRM private-email visibility rule to one audit log entry before
 * it reaches an API response. Module-owned: reuses the exact predicate
 * ({@link isEmailHiddenFrom}) and share-grant lookups the CRM read paths
 * already enforce, so the audit surface can never show MORE than a live CRM
 * read would. Pass-through for every `resourceKind` this module does not own.
 */
export function redactCustomerAuditEntry<T extends RedactableAuditEntry>(
  entry: T,
  ctx: CustomerAuditRedactionContext,
): T {
  if (entry.resourceKind === 'customers.interaction') {
    // Apply the same before/after privacy decision to the diff: a hidden email on
    // either side of the change must not leak its content through `changesJson`,
    // but an authorized or non-email change history (a call-title edit, a shared
    // email edit, the author's own private email edit) keeps its real diff.
    const hidden = isInteractionSnapshotHidden(entry.snapshotBefore, ctx)
      || isInteractionSnapshotHidden(entry.snapshotAfter, ctx)
    return {
      ...entry,
      snapshotBefore: redactInteractionSnapshot(entry.snapshotBefore, ctx),
      snapshotAfter: redactInteractionSnapshot(entry.snapshotAfter, ctx),
      changesJson: hidden ? redactChanges(entry.changesJson) : entry.changesJson,
    }
  }
  if (entry.resourceKind === 'customers.person' || entry.resourceKind === 'customers.company') {
    const beforeEntity = entry.snapshotBefore as { entity?: { id?: unknown } } | undefined
    const afterEntity = entry.snapshotAfter as { entity?: { id?: unknown } } | undefined
    const beforePersonEntityId = typeof beforeEntity?.entity?.id === 'string' ? beforeEntity.entity.id : null
    const afterPersonEntityId = typeof afterEntity?.entity?.id === 'string' ? afterEntity.entity.id : null
    return {
      ...entry,
      snapshotBefore: redactEmbeddedInteractions(entry.snapshotBefore, beforePersonEntityId, ctx),
      snapshotAfter: redactEmbeddedInteractions(entry.snapshotAfter, afterPersonEntityId, ctx),
    }
  }
  return entry
}
