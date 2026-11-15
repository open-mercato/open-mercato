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
const PERSON_RESOURCE_KIND = 'customers.person'
const COMPANY_RESOURCE_KIND = 'customers.company'

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
  snapshotBefore?: unknown
  snapshotAfter?: unknown
  changesJson?: unknown
}

/**
 * The embedded interaction ids a `customers.person`/`customers.company`
 * snapshot's `interactions[]` array names (delete snapshots, and the
 * `interactions` key of a normal update's `before`/`after` payload alike).
 */
function collectEmbeddedInteractionIds(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== 'object') return []
  const interactions = (snapshot as Record<string, unknown>).interactions
  if (!Array.isArray(interactions)) return []
  const ids: string[] = []
  for (const entry of interactions) {
    if (!entry || typeof entry !== 'object') continue
    const id = (entry as Record<string, unknown>).id
    if (typeof id === 'string' && id) ids.push(id)
  }
  return ids
}

/**
 * The same ids, but read from `changesJson.interactions.{from,to}` — the
 * wholesale array diff `redactInteractionsChange` also has to redact.
 */
function collectInteractionIdsFromChanges(changes: unknown): string[] {
  if (!changes || typeof changes !== 'object') return []
  const interactionsChange = (changes as Record<string, unknown>).interactions
  if (!interactionsChange || typeof interactionsChange !== 'object') return []
  const change = interactionsChange as { from?: unknown; to?: unknown }
  return [...collectEmbeddedInteractionIds({ interactions: change.from }), ...collectEmbeddedInteractionIds({ interactions: change.to })]
}

/**
 * Every interaction id a redaction pass over `entries` will need live
 * authority for: the `resourceId` of a standalone `customers.interaction`
 * entry, or the embedded interaction ids a `customers.person`/
 * `customers.company` entry's snapshots and diff name.
 */
function collectInteractionIds(entries: ReadonlyArray<RedactableAuditEntryRef>): string[] {
  const ids: string[] = []
  for (const entry of entries) {
    if (entry.resourceKind === INTERACTION_RESOURCE_KIND) {
      if (typeof entry.resourceId === 'string' && entry.resourceId) ids.push(entry.resourceId)
      continue
    }
    if (entry.resourceKind === PERSON_RESOURCE_KIND || entry.resourceKind === COMPANY_RESOURCE_KIND) {
      ids.push(
        ...collectEmbeddedInteractionIds(entry.snapshotBefore),
        ...collectEmbeddedInteractionIds(entry.snapshotAfter),
        ...collectInteractionIdsFromChanges(entry.changesJson),
      )
    }
  }
  return ids
}

/**
 * Resolves the widening grants, plus the CURRENT live authority of every
 * interaction id (standalone `customers.interaction` entries AND the
 * embedded interactions a `customers.person`/`customers.company` entry
 * names) about to be redacted, for one audit-log read. Fails CLOSED on any
 * error: an empty context (and an empty live-authority map) yields the
 * strict owner-only, "no live record" redaction, never a leak, so a DB
 * hiccup here can only over-redact.
 */
export async function loadCustomerAuditRedactionContext(
  em: EntityManager,
  scope: ConversationShareScope,
  viewerUserId: string | null,
  entries: ReadonlyArray<RedactableAuditEntryRef> = [],
): Promise<CustomerAuditRedactionContext> {
  try {
    const interactionIds = collectInteractionIds(entries)
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
 * Conservative historical fallback: the strictest possible authority. Used
 * whenever a live row cannot be resolved — the stored snapshot's own
 * `visibility`, `channelId`, and parent `entityId` may all be stale (a later
 * revocation, a moved mailbox, a re-linked parent), so NONE of them may be
 * trusted. `entityId: null` specifically means no conversation-share grant
 * can ever apply here — "a historical parent grant existed" is not proof of
 * CURRENT access (see `resolveInteractionAuthority`). Only the stored author
 * id survives into the fallback: authorship never changes, so an author can
 * always see their own historical content regardless of what else is
 * unverifiable.
 */
function conservativeInteractionAuthority(storedAuthorUserId: string | null): LiveInteractionAuthority {
  return { visibility: 'private', authorUserId: storedAuthorUserId, channelId: null, entityId: null }
}

/**
 * Resolves the authority to decide visibility for ONE historical interaction
 * representation: the CURRENT live row when it resolves, else the
 * conservative fallback above.
 *
 * `interactionId` is the snapshot's OWN id when present, falling back to the
 * enclosing audit entry's `resourceId` (both name the same interaction) when
 * the snapshot itself carries no id — there is no circumstance where neither
 * identifies the interaction for a real `customers.interaction` audit entry,
 * but defensively, if both are absent, the fallback still applies rather than
 * trusting unverifiable stored data.
 *
 * When a live row DOES resolve, its `authorUserId` is used exactly as
 * stored there — including `null` — and never backfilled from the
 * snapshot's historical author: `customers.interactions.update` lets the
 * existing author transfer ownership to someone else, so the stored author
 * is not a safe stand-in for "no current author" or for a now-different
 * one. The historical author only survives into the CONSERVATIVE fallback,
 * where there is no live row at all to contradict it.
 */
function resolveInteractionAuthority(
  interactionId: string | null,
  storedAuthorUserId: string | null,
  ctx: CustomerAuditRedactionContext,
): LiveInteractionAuthority {
  const live = interactionId ? ctx.liveInteractionsById.get(interactionId) : undefined
  if (live) {
    return {
      visibility: live.visibility,
      authorUserId: live.authorUserId,
      channelId: live.channelId,
      entityId: live.entityId,
    }
  }
  return conservativeInteractionAuthority(storedAuthorUserId)
}

function redactRecordFields(record: Record<string, unknown>): Record<string, unknown> {
  const next = { ...record }
  for (const field of REDACTED_INTERACTION_FIELDS) {
    if (field in next) next[field] = null
  }
  return next
}

function isHiddenEmailInteraction(
  interaction: { id?: unknown; interactionType?: unknown; authorUserId?: unknown },
  fallbackInteractionId: string | null,
  ctx: CustomerAuditRedactionContext,
): boolean {
  const interactionType = typeof interaction.interactionType === 'string' ? interaction.interactionType : null
  if (interactionType !== 'email') return false
  const ownId = typeof interaction.id === 'string' && interaction.id ? interaction.id : null
  const interactionId = ownId ?? fallbackInteractionId
  const storedAuthorUserId = typeof interaction.authorUserId === 'string' ? interaction.authorUserId : null
  // The stored snapshot's `visibility`/`channelId`/parent never factor in here —
  // only the resolved CURRENT authority does. See `resolveInteractionAuthority`.
  const authority = resolveInteractionAuthority(interactionId, storedAuthorUserId, ctx)
  return isEmailHiddenFrom({
    interactionType,
    visibility: authority.visibility,
    authorUserId: authority.authorUserId,
    currentUserId: ctx.viewerUserId,
    personEntityId: authority.entityId,
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
function isInteractionSnapshotHidden(
  snapshot: unknown,
  fallbackInteractionId: string | null,
  ctx: CustomerAuditRedactionContext,
): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false
  const record = snapshot as Record<string, unknown>
  const interaction = record.interaction
  if (!interaction || typeof interaction !== 'object') return false
  return isHiddenEmailInteraction(interaction as Record<string, unknown>, fallbackInteractionId, ctx)
}

/**
 * Redacts a single `InteractionSnapshot`-shaped audit payload (`{ interaction: {...}, custom: {...} }`,
 * the shape `customers.interaction` audit entries store). Mirrors the exact rule
 * {@link isEmailHiddenFrom} enforces on live CRM reads. `custom` is a sibling of
 * `interaction`, not nested inside it, so it needs its own clear alongside the
 * `redactRecordFields` pass over `interaction`.
 */
function redactInteractionSnapshot(
  snapshot: unknown,
  fallbackInteractionId: string | null,
  ctx: CustomerAuditRedactionContext,
): unknown {
  if (!isInteractionSnapshotHidden(snapshot, fallbackInteractionId, ctx)) return snapshot
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
 * stored audit row cannot tell whether an embedded email was shared. Delegates
 * the hidden/visible decision to {@link isHiddenEmailInteraction} — the exact
 * same CURRENT-authority rule (visibility, shared channel, conversation
 * share, author) standalone `customers.interaction` entries use, resolved
 * fresh per entry by its own `id` rather than the snapshot's historical
 * stored fields or container parent. `customers.interactions.update` lets the
 * existing author transfer ownership and lets an interaction move to a
 * different Person/Company, so a historical grant/visibility for the OLD
 * author/parent must not authorize a representation that now belongs to a
 * different, unshared one — but a CURRENTLY shared email or shared-mailbox
 * channel must stay just as readable here as it is on a live CRM read or a
 * standalone interaction audit entry.
 */
function redactEmbeddedInteractionEntries(
  interactions: unknown[],
  ctx: CustomerAuditRedactionContext,
): unknown[] {
  return interactions.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    const interaction = entry as Record<string, unknown>
    if (!isHiddenEmailInteraction(interaction, null, ctx)) return entry
    return redactRecordFields(interaction)
  })
}

function redactEmbeddedInteractions(snapshot: unknown, ctx: CustomerAuditRedactionContext): unknown {
  if (!snapshot || typeof snapshot !== 'object') return snapshot
  const record = snapshot as Record<string, unknown>
  const interactions = record.interactions
  if (!Array.isArray(interactions)) return snapshot
  return { ...record, interactions: redactEmbeddedInteractionEntries(interactions, ctx) }
}

/**
 * The command bus diffs top-level snapshot keys wholesale (`buildRecordChangesDeep`
 * never descends into arrays), so a changed `interactions` array on a
 * `customers.person`/`customers.company` update lands in
 * `changesJson.interactions.{from,to}` as full, unredacted entries — even
 * though {@link redactEmbeddedInteractions} already hid them on the snapshots
 * above. Apply the same per-entry rule to both sides of that diff.
 */
function redactInteractionsChange(changes: unknown, ctx: CustomerAuditRedactionContext): unknown {
  if (!changes || typeof changes !== 'object') return changes
  const record = { ...(changes as Record<string, unknown>) }
  const interactionsChange = record.interactions
  if (!interactionsChange || typeof interactionsChange !== 'object') return record
  const change = interactionsChange as { from?: unknown; to?: unknown }
  if (!Array.isArray(change.from) && !Array.isArray(change.to)) return record
  record.interactions = {
    ...change,
    from: Array.isArray(change.from) ? redactEmbeddedInteractionEntries(change.from, ctx) : change.from,
    to: Array.isArray(change.to) ? redactEmbeddedInteractionEntries(change.to, ctx) : change.to,
  }
  return record
}

export type RedactableAuditEntry = {
  resourceKind?: string | null
  /**
   * The audit row's own id for the resource it describes — the fallback
   * identifier `isHiddenEmailInteraction` resolves live authority against
   * when a `customers.interaction` snapshot's own `interaction.id` is absent.
   */
  resourceId?: string | null
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
  if (entry.resourceKind === INTERACTION_RESOURCE_KIND) {
    const fallbackInteractionId = typeof entry.resourceId === 'string' && entry.resourceId ? entry.resourceId : null
    // Apply the same before/after privacy decision to the diff: a hidden email on
    // either side of the change must not leak its content through `changesJson`,
    // but an authorized or non-email change history (a call-title edit, a shared
    // email edit, the author's own private email edit) keeps its real diff.
    const hidden = isInteractionSnapshotHidden(entry.snapshotBefore, fallbackInteractionId, ctx)
      || isInteractionSnapshotHidden(entry.snapshotAfter, fallbackInteractionId, ctx)
    return {
      ...entry,
      snapshotBefore: redactInteractionSnapshot(entry.snapshotBefore, fallbackInteractionId, ctx),
      snapshotAfter: redactInteractionSnapshot(entry.snapshotAfter, fallbackInteractionId, ctx),
      changesJson: hidden ? redactChanges(entry.changesJson) : entry.changesJson,
    }
  }
  if (entry.resourceKind === PERSON_RESOURCE_KIND || entry.resourceKind === COMPANY_RESOURCE_KIND) {
    return {
      ...entry,
      snapshotBefore: redactEmbeddedInteractions(entry.snapshotBefore, ctx),
      snapshotAfter: redactEmbeddedInteractions(entry.snapshotAfter, ctx),
      changesJson: redactInteractionsChange(entry.changesJson, ctx),
    }
  }
  return entry
}
