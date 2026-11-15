import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { isEmailHiddenFrom } from './visibilityFilter'
import {
  listGrantsForViewer,
  listSharedChannelIds,
  loadLiveInteractionAuthority,
  type ConversationShareGrant,
  type ConversationShareScope,
  type LiveInteractionAuthority,
} from './conversationShares'

const logger = createLogger('customers')

const REDACTED_INTERACTION_FIELDS: readonly string[] = ['title', 'body', 'participants', 'linkedEntities', 'custom']

const INTERACTION_RESOURCE_KIND = 'customers.interaction'

export type CustomerAuditRedactionContext = {
  viewerUserId: string | null
  sharedConversations: ConversationShareGrant[]
  sharedChannelIds: string[]
  liveInteractionsById: Map<string, LiveInteractionAuthority>
}

/**
 * Minimal shape `loadCustomerAuditRedactionContext` needs from the audit
 * entries about to be redacted — kept generic (no `ActionLog` import) so this
 * CRM-owned provider stays decoupled from the audit module's entity shape,
 * per `packages/core/AGENTS.md` § Cross-Module Coupling.
 */
export type RedactableAuditEntryRef = {
  resourceKind?: string | null
  resourceId?: string | null
}

/**
 * Resolves the widening grants, plus the CURRENT live authority of every
 * `customers.interaction` entry about to be redacted, for one audit-log read.
 * Fails CLOSED on any error: an empty context (and an empty live-authority
 * map) yields the strict owner-only, "no live record" redaction, never a
 * leak, so a DB hiccup here can only over-redact.
 */
export async function loadCustomerAuditRedactionContext(
  em: EntityManager,
  scope: ConversationShareScope,
  viewerUserId: string | null,
  entries: ReadonlyArray<RedactableAuditEntryRef> = [],
): Promise<CustomerAuditRedactionContext> {
  try {
    const interactionIds = entries
      .filter((entry) => entry.resourceKind === INTERACTION_RESOURCE_KIND)
      .map((entry) => entry.resourceId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    const [sharedConversations, sharedChannelIds, liveInteractionsById] = await Promise.all([
      listGrantsForViewer(em, scope, viewerUserId),
      listSharedChannelIds(em, scope, viewerUserId),
      loadLiveInteractionAuthority(em, scope, interactionIds),
    ])
    return { viewerUserId, sharedConversations, sharedChannelIds, liveInteractionsById }
  } catch (err) {
    logger.warn('[internal] failed to resolve CRM audit redaction context; failing closed', { err })
    getTelemetryRuntime()?.reportError(err, {
      module: 'customers',
      code: 'customers.audit_redaction_context_load_failed',
    })
    return { viewerUserId, sharedConversations: [], sharedChannelIds: [], liveInteractionsById: new Map() }
  }
}

/**
 * Resolves the authority to decide visibility for ONE historical interaction
 * representation: the CURRENT live row when the snapshot carries an id to
 * resolve it against, else the entry's own stored fields.
 *
 * A stored snapshot's own `visibility` can be stale — the email may have been
 * `shared` when this audit entry was recorded and revoked to `private`
 * since — so whenever a live row CAN be resolved, only its CURRENT values may
 * be trusted for that decision. When the id resolves to no live row (deleted,
 * or the batch lookup failed), assume the strictest state (`private`, no
 * known shared channel) rather than trusting the now-unverifiable stored
 * visibility. When the snapshot carries no id at all — audit data written
 * before `customers.interaction` snapshots captured one — there is nothing to
 * resolve against, so the entry's own stored fields are the only signal
 * available and are used as-is, exactly as before this function existed. The
 * stored author id is kept in every case: authorship never changes, so an
 * author can always see their own historical content.
 */
function resolveInteractionAuthority(
  interactionId: string | null,
  storedAuthorUserId: string | null,
  storedVisibility: string | null,
  storedChannelId: string | null,
  ctx: CustomerAuditRedactionContext,
): LiveInteractionAuthority {
  if (!interactionId) {
    return { visibility: storedVisibility, authorUserId: storedAuthorUserId, channelId: storedChannelId }
  }
  const live = ctx.liveInteractionsById.get(interactionId)
  if (live) {
    return {
      visibility: live.visibility,
      authorUserId: live.authorUserId ?? storedAuthorUserId,
      channelId: live.channelId,
    }
  }
  return { visibility: 'private', authorUserId: storedAuthorUserId, channelId: null }
}

function redactRecordFields(record: Record<string, unknown>): Record<string, unknown> {
  const next = { ...record }
  for (const field of REDACTED_INTERACTION_FIELDS) {
    if (field in next) next[field] = null
  }
  return next
}

function isHiddenEmailInteraction(
  interaction: { id?: unknown; interactionType?: unknown; visibility?: unknown; authorUserId?: unknown; channelId?: unknown },
  personEntityId: string | null,
  ctx: CustomerAuditRedactionContext,
): boolean {
  const interactionType = typeof interaction.interactionType === 'string' ? interaction.interactionType : null
  if (interactionType !== 'email') return false
  const interactionId = typeof interaction.id === 'string' ? interaction.id : null
  const storedAuthorUserId = typeof interaction.authorUserId === 'string' ? interaction.authorUserId : null
  const storedVisibility = typeof interaction.visibility === 'string' ? interaction.visibility : null
  const storedChannelId = typeof interaction.channelId === 'string' ? interaction.channelId : null
  // When the snapshot carries an id, its stored `visibility`/`channelId`
  // describe the state AT THE TIME this audit entry was recorded, which a
  // later shared→private revocation can make stale — resolve the CURRENT
  // authority instead of trusting them. See `resolveInteractionAuthority`.
  const authority = resolveInteractionAuthority(interactionId, storedAuthorUserId, storedVisibility, storedChannelId, ctx)
  return isEmailHiddenFrom({
    interactionType,
    visibility: authority.visibility,
    authorUserId: authority.authorUserId,
    currentUserId: ctx.viewerUserId,
    personEntityId,
    sharedConversations: ctx.sharedConversations,
    channelId: authority.channelId,
    sharedChannelIds: ctx.sharedChannelIds,
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
function redactEmbeddedInteractionEntries(
  interactions: unknown[],
  personEntityId: string | null,
  ctx: CustomerAuditRedactionContext,
): unknown[] {
  return interactions.map((entry) => {
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
}

function redactEmbeddedInteractions(
  snapshot: unknown,
  personEntityId: string | null,
  ctx: CustomerAuditRedactionContext,
): unknown {
  if (!snapshot || typeof snapshot !== 'object') return snapshot
  const record = snapshot as Record<string, unknown>
  const interactions = record.interactions
  if (!Array.isArray(interactions)) return snapshot
  return { ...record, interactions: redactEmbeddedInteractionEntries(interactions, personEntityId, ctx) }
}

/**
 * The command bus diffs top-level snapshot keys wholesale (`buildRecordChangesDeep`
 * never descends into arrays), so a changed `interactions` array on a
 * `customers.person`/`customers.company` update lands in
 * `changesJson.interactions.{from,to}` as full, unredacted entries — even
 * though {@link redactEmbeddedInteractions} already hid them on the snapshots
 * above. Apply the same per-entry rule to both sides of that diff.
 */
function redactInteractionsChange(
  changes: unknown,
  beforePersonEntityId: string | null,
  afterPersonEntityId: string | null,
  ctx: CustomerAuditRedactionContext,
): unknown {
  if (!changes || typeof changes !== 'object') return changes
  const record = { ...(changes as Record<string, unknown>) }
  const interactionsChange = record.interactions
  if (!interactionsChange || typeof interactionsChange !== 'object') return record
  const change = interactionsChange as { from?: unknown; to?: unknown }
  if (!Array.isArray(change.from) && !Array.isArray(change.to)) return record
  record.interactions = {
    ...change,
    from: Array.isArray(change.from)
      ? redactEmbeddedInteractionEntries(change.from, beforePersonEntityId, ctx)
      : change.from,
    to: Array.isArray(change.to)
      ? redactEmbeddedInteractionEntries(change.to, afterPersonEntityId, ctx)
      : change.to,
  }
  return record
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
      changesJson: redactInteractionsChange(entry.changesJson, beforePersonEntityId, afterPersonEntityId, ctx),
    }
  }
  return entry
}
