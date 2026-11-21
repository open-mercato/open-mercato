import type { EntityManager } from '@mikro-orm/postgresql'
import { loadCustomerAuditRedactionContext, redactCustomerAuditEntry, type CustomerAuditRedactionContext } from '../auditRedaction'
import * as conversationShares from '../conversationShares'

const OWNER = 'user-owner'
const VIEWER = 'user-viewer'
const PERSON_ID = 'person-1'
const mockEm = {} as unknown as EntityManager

type InteractionFields = {
  entityId?: string
  interactionType?: string
  visibility?: string | null
  authorUserId?: string
  title?: unknown
  body?: unknown
  participants?: unknown
  linkedEntities?: unknown
  custom?: unknown
}

type InteractionSnapshot = {
  interaction: InteractionFields
  custom?: unknown
}

type EmbeddedInteractionsSnapshot = {
  entity: { id: string }
  interactions: InteractionFields[]
}

function interactionSnapshot(value: unknown): InteractionSnapshot {
  return value as InteractionSnapshot
}

function embeddedInteractionsSnapshot(value: unknown): EmbeddedInteractionsSnapshot {
  return value as EmbeddedInteractionsSnapshot
}

function ctx(overrides: Partial<CustomerAuditRedactionContext> = {}): CustomerAuditRedactionContext {
  return {
    viewerUserId: VIEWER,
    sharedConversations: [],
    sharedChannelIds: [],
    liveInteractionsById: new Map(),
    ...overrides,
  }
}

function verifiedOwnerCtx(): CustomerAuditRedactionContext {
  return ctx({
    viewerUserId: OWNER,
    liveInteractionsById: new Map([
      ['verified-interaction', { visibility: 'private', authorUserId: OWNER, channelId: null, entityId: PERSON_ID }],
    ]),
  })
}

describe('redactCustomerAuditEntry — customers.interaction', () => {
  const INTERACTION_ID = 'interaction-1'

  // Every test here exercises a live record found at `INTERACTION_ID` whose
  // fields match whatever the snapshot stores (no revocation/move scenario in
  // this block — those live in the dedicated describe blocks below), so the
  // resolved CURRENT authority and the stored historical fields agree.
  function liveCtx(
    liveOverrides: Partial<conversationShares.LiveInteractionAuthority> = {},
    ctxOverrides: Partial<CustomerAuditRedactionContext> = {},
  ): CustomerAuditRedactionContext {
    return ctx({
      liveInteractionsById: new Map([
        [
          INTERACTION_ID,
          { visibility: 'private', authorUserId: OWNER, channelId: null, entityId: PERSON_ID, ...liveOverrides },
        ],
      ]),
      ...ctxOverrides,
    })
  }

  function interactionEntry(overrides: Record<string, unknown> = {}) {
    return {
      resourceKind: 'customers.interaction',
      snapshotBefore: {
        interaction: {
          id: INTERACTION_ID,
          entityId: PERSON_ID,
          interactionType: 'email',
          visibility: 'private',
          authorUserId: OWNER,
          title: 'Private subject',
          body: 'Private body',
        },
      },
      snapshotAfter: null,
      changesJson: null,
      ...overrides,
    }
  }

  it('redacts title/body for a private email when the viewer is not the author', () => {
    const redacted = redactCustomerAuditEntry(interactionEntry(), liveCtx())
    const interaction = interactionSnapshot(redacted.snapshotBefore).interaction
    expect(interaction.title).toBeNull()
    expect(interaction.body).toBeNull()
    // Non-content fields stay intact.
    expect(interaction.authorUserId).toBe(OWNER)
  })

  it('leaves title/body visible to the email author', () => {
    const redacted = redactCustomerAuditEntry(interactionEntry(), liveCtx({}, { viewerUserId: OWNER }))
    const interaction = interactionSnapshot(redacted.snapshotBefore).interaction
    expect(interaction.title).toBe('Private subject')
    expect(interaction.body).toBe('Private body')
  })

  it('leaves title/body visible when a conversation share grants the viewer access', () => {
    const redacted = redactCustomerAuditEntry(
      interactionEntry(),
      liveCtx({}, { sharedConversations: [{ personEntityId: PERSON_ID, ownerUserId: OWNER }] }),
    )
    const interaction = interactionSnapshot(redacted.snapshotBefore).interaction
    expect(interaction.title).toBe('Private subject')
    expect(interaction.body).toBe('Private body')
  })

  it('leaves legacy visibility:null rows visible (parity with the live CRM filter)', () => {
    const entry = interactionEntry({
      snapshotBefore: {
        interaction: {
          id: INTERACTION_ID,
          entityId: PERSON_ID,
          interactionType: 'email',
          visibility: null,
          authorUserId: OWNER,
          title: 'Legacy subject',
          body: 'Legacy body',
        },
      },
    })
    const redacted = redactCustomerAuditEntry(entry, liveCtx({ visibility: null }))
    const interaction = interactionSnapshot(redacted.snapshotBefore).interaction
    expect(interaction.title).toBe('Legacy subject')
    expect(interaction.body).toBe('Legacy body')
  })

  it('redacts participants/linkedEntities alongside title/body for a private email when the viewer is not the author', () => {
    const entry = interactionEntry({
      snapshotBefore: {
        interaction: {
          id: INTERACTION_ID,
          entityId: PERSON_ID,
          interactionType: 'email',
          visibility: 'private',
          authorUserId: OWNER,
          title: 'Private subject',
          body: 'Private body',
          participants: [{ userId: 'user-3', name: 'Third Party', email: 'third@example.com' }],
          linkedEntities: [{ id: 'deal-1', type: 'deal', label: 'Confidential Deal' }],
        },
      },
    })
    const redacted = redactCustomerAuditEntry(entry, liveCtx())
    const interaction = interactionSnapshot(redacted.snapshotBefore).interaction
    expect(interaction.participants).toBeNull()
    expect(interaction.linkedEntities).toBeNull()
  })

  it('leaves participants/linkedEntities visible to the email author', () => {
    const entry = interactionEntry({
      snapshotBefore: {
        interaction: {
          id: INTERACTION_ID,
          entityId: PERSON_ID,
          interactionType: 'email',
          visibility: 'private',
          authorUserId: OWNER,
          title: 'Private subject',
          body: 'Private body',
          participants: [{ userId: 'user-3', name: 'Third Party', email: 'third@example.com' }],
          linkedEntities: [{ id: 'deal-1', type: 'deal', label: 'Confidential Deal' }],
        },
      },
    })
    const redacted = redactCustomerAuditEntry(entry, liveCtx({}, { viewerUserId: OWNER }))
    const interaction = interactionSnapshot(redacted.snapshotBefore).interaction
    expect(interaction.participants).toEqual([{ userId: 'user-3', name: 'Third Party', email: 'third@example.com' }])
    expect(interaction.linkedEntities).toEqual([{ id: 'deal-1', type: 'deal', label: 'Confidential Deal' }])
  })

  it('strips participants/linkedEntities keys from the changes diff when the row is hidden', () => {
    const entry = interactionEntry({
      changesJson: {
        participants: { from: [], to: [{ userId: 'user-3', email: 'third@example.com' }] },
        linkedEntities: { from: [], to: [{ id: 'deal-1', type: 'deal', label: 'Confidential Deal' }] },
        status: { from: 'planned', to: 'done' },
      },
    })
    const redacted = redactCustomerAuditEntry(entry, liveCtx())
    expect(redacted.changesJson).toEqual({ status: { from: 'planned', to: 'done' } })
  })

  it('redacts the custom-field snapshot alongside title/body for a private email when the viewer is not the author', () => {
    const entry = interactionEntry({
      snapshotBefore: {
        interaction: {
          id: INTERACTION_ID,
          entityId: PERSON_ID,
          interactionType: 'email',
          visibility: 'private',
          authorUserId: OWNER,
          title: 'Private subject',
          body: 'Private body',
        },
        custom: { privateEmail: 'ghost@example.com', note: 'internal' },
      },
    })
    const redacted = redactCustomerAuditEntry(entry, liveCtx())
    expect(interactionSnapshot(redacted.snapshotBefore).custom).toBeNull()
  })

  it('leaves the custom-field snapshot visible to the email author', () => {
    const entry = interactionEntry({
      snapshotBefore: {
        interaction: {
          id: INTERACTION_ID,
          entityId: PERSON_ID,
          interactionType: 'email',
          visibility: 'private',
          authorUserId: OWNER,
          title: 'Private subject',
          body: 'Private body',
        },
        custom: { privateEmail: 'ghost@example.com', note: 'internal' },
      },
    })
    const redacted = redactCustomerAuditEntry(entry, liveCtx({}, { viewerUserId: OWNER }))
    expect(interactionSnapshot(redacted.snapshotBefore).custom).toEqual({ privateEmail: 'ghost@example.com', note: 'internal' })
  })

  it('leaves non-email interactions untouched', () => {
    const entry = interactionEntry({
      snapshotBefore: {
        interaction: {
          id: INTERACTION_ID,
          entityId: PERSON_ID,
          interactionType: 'call',
          visibility: 'private',
          authorUserId: OWNER,
          title: 'Call notes',
          body: 'Call body',
        },
      },
    })
    const redacted = redactCustomerAuditEntry(entry, liveCtx())
    const interaction = interactionSnapshot(redacted.snapshotBefore).interaction
    expect(interaction.title).toBe('Call notes')
    expect(interaction.body).toBe('Call body')
  })

  it('strips title/body keys from the changes diff when the row is hidden', () => {
    const entry = interactionEntry({
      changesJson: { title: { from: 'old', to: 'new' }, body: { from: 'a', to: 'b' }, status: { from: 'planned', to: 'done' } },
    })
    const redacted = redactCustomerAuditEntry(entry, liveCtx())
    expect(redacted.changesJson).toEqual({ status: { from: 'planned', to: 'done' } })
  })

  // Regression for the maintainer review on #8978 — the command bus
  // (`packages/shared/src/lib/commands/command-bus.ts`) flattens custom-field
  // snapshot changes into top-level `cf_<name>` diff entries, not a nested
  // `custom` key, so the earlier fix (clearing `snapshot.custom`) never touched
  // this representation of the same private data.
  it('strips canonical cf_<name> custom-field diffs from the changes diff when the row is hidden', () => {
    const entry = interactionEntry({
      changesJson: {
        cf_privateEmail: { from: 'old@example.test', to: 'new@example.test' },
        status: { from: 'planned', to: 'done' },
      },
    })
    const redacted = redactCustomerAuditEntry(entry, liveCtx())
    expect(redacted.changesJson).toEqual({ status: { from: 'planned', to: 'done' } })
  })

  it('leaves cf_<name> custom-field diffs visible to the email author', () => {
    const entry = interactionEntry({
      changesJson: {
        cf_privateEmail: { from: 'old@example.test', to: 'new@example.test' },
        status: { from: 'planned', to: 'done' },
      },
    })
    const redacted = redactCustomerAuditEntry(entry, liveCtx({}, { viewerUserId: OWNER }))
    expect(redacted.changesJson).toEqual({
      cf_privateEmail: { from: 'old@example.test', to: 'new@example.test' },
      status: { from: 'planned', to: 'done' },
    })
  })

  // Regression for the maintainer review on #8978 — `redactChanges` used to run
  // unconditionally for every `customers.interaction` entry, so authorized and
  // non-email change histories lost real diffs (title/body/participants/
  // linkedEntities) they were never hidden from this viewer in the first place.
  it('leaves the changes diff untouched for a non-email (call) interaction', () => {
    const entry = interactionEntry({
      snapshotBefore: {
        interaction: {
          id: INTERACTION_ID,
          entityId: PERSON_ID,
          interactionType: 'call',
          visibility: 'private',
          authorUserId: OWNER,
        },
      },
      changesJson: { title: { from: 'Old call title', to: 'New call title' }, status: { from: 'planned', to: 'done' } },
    })
    const redacted = redactCustomerAuditEntry(entry, liveCtx())
    expect(redacted.changesJson).toEqual({
      title: { from: 'Old call title', to: 'New call title' },
      status: { from: 'planned', to: 'done' },
    })
  })

  it('leaves the changes diff untouched for a shared email the viewer has a conversation-share grant for', () => {
    const entry = interactionEntry({
      snapshotBefore: {
        interaction: {
          id: INTERACTION_ID,
          entityId: PERSON_ID,
          interactionType: 'email',
          visibility: 'private',
          authorUserId: OWNER,
        },
      },
      changesJson: { title: { from: 'Old subject', to: 'New subject' } },
    })
    const redacted = redactCustomerAuditEntry(
      entry,
      liveCtx({}, { sharedConversations: [{ personEntityId: PERSON_ID, ownerUserId: OWNER }] }),
    )
    expect(redacted.changesJson).toEqual({ title: { from: 'Old subject', to: 'New subject' } })
  })

  it('leaves the changes diff untouched for the email author\'s own private email edit', () => {
    const entry = interactionEntry({
      snapshotBefore: {
        interaction: {
          id: INTERACTION_ID,
          entityId: PERSON_ID,
          interactionType: 'email',
          visibility: 'private',
          authorUserId: OWNER,
        },
      },
      changesJson: { title: { from: 'Old subject', to: 'New subject' } },
    })
    const redacted = redactCustomerAuditEntry(entry, liveCtx({}, { viewerUserId: OWNER }))
    expect(redacted.changesJson).toEqual({ title: { from: 'Old subject', to: 'New subject' } })
  })

  it('redacts the changes diff when only the after-snapshot is a hidden email (visible-to-hidden transition)', () => {
    const entry = interactionEntry({
      snapshotBefore: {
        interaction: {
          id: INTERACTION_ID,
          entityId: PERSON_ID,
          interactionType: 'call',
          visibility: 'private',
          authorUserId: OWNER,
        },
      },
      snapshotAfter: {
        interaction: {
          id: INTERACTION_ID,
          entityId: PERSON_ID,
          interactionType: 'email',
          visibility: 'private',
          authorUserId: OWNER,
          title: 'New private subject',
        },
      },
      changesJson: {
        interactionType: { from: 'call', to: 'email' },
        title: { from: null, to: 'New private subject' },
      },
    })
    const redacted = redactCustomerAuditEntry(entry, liveCtx())
    expect(redacted.changesJson).toEqual({ interactionType: { from: 'call', to: 'email' } })
  })

  it('passes through entries for resource kinds it does not own', () => {
    const entry = { resourceKind: 'sales.order', snapshotBefore: { foo: 'bar' } }
    expect(redactCustomerAuditEntry(entry, liveCtx())).toBe(entry)
  })
})

// Regression for @pkarw's review on #8978 (pullrequestreview-5909076861) —
// `isInteractionSnapshotHidden` used to decide visibility from EACH snapshot's
// own stored `visibility`, recorded at the time that audit entry was written.
// A shared→private revocation left every historical "shared" snapshot (and its
// diff) readable to a non-owner forever, since the live CRM read denies access
// but the audit trail never re-checked. `loadCustomerAuditRedactionContext`'s
// batched live-interaction lookup (`liveInteractionsById`) is how the CURRENT
// authority reaches these checks.
describe('redactCustomerAuditEntry — customers.interaction revocation (live authority)', () => {
  const INTERACTION_ID = 'interaction-1'

  function revocationEntry(overrides: Record<string, unknown> = {}) {
    return {
      resourceKind: 'customers.interaction',
      // The audit row recorded when the email was still shared: nothing about
      // THIS entry's own stored data signals it is private today.
      snapshotBefore: {
        interaction: {
          id: INTERACTION_ID,
          entityId: PERSON_ID,
          interactionType: 'email',
          visibility: 'shared',
          authorUserId: OWNER,
          title: 'Old shared subject',
          body: 'Old shared body',
        },
      },
      snapshotAfter: {
        interaction: {
          id: INTERACTION_ID,
          entityId: PERSON_ID,
          interactionType: 'email',
          visibility: 'shared',
          authorUserId: OWNER,
          title: 'Newer shared subject',
          body: 'Newer shared body',
        },
      },
      changesJson: {
        title: { from: 'Old shared subject', to: 'Newer shared subject' },
        body: { from: 'Old shared body', to: 'Newer shared body' },
      },
      ...overrides,
    }
  }

  it('hides both historical snapshots and the diff once the live record is private', () => {
    const contextWithLiveAuthority = ctx({
      liveInteractionsById: new Map([
        [INTERACTION_ID, { visibility: 'private', authorUserId: OWNER, channelId: null, entityId: PERSON_ID }],
      ]),
    })
    const redacted = redactCustomerAuditEntry(revocationEntry(), contextWithLiveAuthority)
    expect(interactionSnapshot(redacted.snapshotBefore).interaction.title).toBeNull()
    expect(interactionSnapshot(redacted.snapshotBefore).interaction.body).toBeNull()
    expect(interactionSnapshot(redacted.snapshotAfter).interaction.title).toBeNull()
    expect(interactionSnapshot(redacted.snapshotAfter).interaction.body).toBeNull()
    expect(redacted.changesJson).toEqual({})
  })

  it('hides an older shared-at-the-time entry too, once its interaction is revoked live', () => {
    // Only snapshotBefore present — a create/update entry recorded while the
    // conversation was still shared, long before the later revocation.
    const entry = revocationEntry({ snapshotAfter: null, changesJson: null })
    const contextWithLiveAuthority = ctx({
      liveInteractionsById: new Map([
        [INTERACTION_ID, { visibility: 'private', authorUserId: OWNER, channelId: null, entityId: PERSON_ID }],
      ]),
    })
    const redacted = redactCustomerAuditEntry(entry, contextWithLiveAuthority)
    expect(interactionSnapshot(redacted.snapshotBefore).interaction.title).toBeNull()
  })

  it('keeps the historical content visible to the email author regardless of revocation', () => {
    const contextWithLiveAuthority = ctx({
      viewerUserId: OWNER,
      liveInteractionsById: new Map([
        [INTERACTION_ID, { visibility: 'private', authorUserId: OWNER, channelId: null, entityId: PERSON_ID }],
      ]),
    })
    const redacted = redactCustomerAuditEntry(revocationEntry(), contextWithLiveAuthority)
    expect(interactionSnapshot(redacted.snapshotBefore).interaction.title).toBe('Old shared subject')
    expect(redacted.changesJson).toEqual({
      title: { from: 'Old shared subject', to: 'Newer shared subject' },
      body: { from: 'Old shared body', to: 'Newer shared body' },
    })
  })

  it('keeps the historical content visible when a CURRENT conversation-share grant covers it', () => {
    const contextWithLiveAuthority = ctx({
      liveInteractionsById: new Map([
        [INTERACTION_ID, { visibility: 'private', authorUserId: OWNER, channelId: null, entityId: PERSON_ID }],
      ]),
      sharedConversations: [{ personEntityId: PERSON_ID, ownerUserId: OWNER }],
    })
    const redacted = redactCustomerAuditEntry(revocationEntry(), contextWithLiveAuthority)
    expect(interactionSnapshot(redacted.snapshotBefore).interaction.title).toBe('Old shared subject')
  })

  it('hides the historical content when the conversation share itself has since been revoked (no grant in context)', () => {
    // No matching grant in `sharedConversations` — the share was revoked, so
    // the strict live-private rule applies with no widening.
    const contextWithLiveAuthority = ctx({
      liveInteractionsById: new Map([
        [INTERACTION_ID, { visibility: 'private', authorUserId: OWNER, channelId: null, entityId: PERSON_ID }],
      ]),
      sharedConversations: [],
    })
    const redacted = redactCustomerAuditEntry(revocationEntry(), contextWithLiveAuthority)
    expect(interactionSnapshot(redacted.snapshotBefore).interaction.title).toBeNull()
  })

  it('does not trust the historical owner when current authority cannot be verified', () => {
    const entry = revocationEntry()
    const redacted = redactCustomerAuditEntry(entry, ctx({ viewerUserId: OWNER }))
    expect(interactionSnapshot(redacted.snapshotBefore).interaction.title).toBeNull()
    expect(interactionSnapshot(redacted.snapshotAfter).interaction.body).toBeNull()
    expect(redacted.changesJson).toEqual({})
    expect(interactionSnapshot(entry.snapshotBefore).interaction.title).toBe('Old shared subject')
  })

  it('fails closed to hidden when the interaction has been deleted (no live record resolves)', () => {
    // The batched lookup found nothing for this id — deleted, or otherwise
    // unresolvable — so the conservative fallback (private) applies even
    // though the stored snapshot says "shared".
    const redacted = redactCustomerAuditEntry(revocationEntry(), ctx({ liveInteractionsById: new Map() }))
    expect(interactionSnapshot(redacted.snapshotBefore).interaction.title).toBeNull()
    expect(redacted.changesJson).toEqual({})
  })

  it('keeps a still-shared interaction visible end to end (no false-positive redaction)', () => {
    const contextWithLiveAuthority = ctx({
      liveInteractionsById: new Map([
        [INTERACTION_ID, { visibility: 'shared', authorUserId: OWNER, channelId: null, entityId: PERSON_ID }],
      ]),
    })
    const redacted = redactCustomerAuditEntry(revocationEntry(), contextWithLiveAuthority)
    expect(interactionSnapshot(redacted.snapshotBefore).interaction.title).toBe('Old shared subject')
    expect(interactionSnapshot(redacted.snapshotAfter).interaction.title).toBe('Newer shared subject')
    expect(redacted.changesJson).toEqual({
      title: { from: 'Old shared subject', to: 'Newer shared subject' },
      body: { from: 'Old shared body', to: 'Newer shared body' },
    })
  })

  // Regression for @pkarw's review on #8978 (pullrequestreview-5909526934) —
  // the live authorUserId must win outright once a live row resolves, never
  // fall back to the snapshot's historical stored author: ownership can
  // transfer via `customers.interactions.update`.
  it('a grant for the OLD (former) author does not authorize a non-owner after ownership transferred', () => {
    const NEW_OWNER = 'user-new-owner'
    const contextWithLiveAuthority = ctx({
      liveInteractionsById: new Map([
        [INTERACTION_ID, { visibility: 'private', authorUserId: NEW_OWNER, channelId: null, entityId: PERSON_ID }],
      ]),
      // Grant only ever covered the OLD (stored) author.
      sharedConversations: [{ personEntityId: PERSON_ID, ownerUserId: OWNER }],
    })
    const redacted = redactCustomerAuditEntry(revocationEntry(), contextWithLiveAuthority)
    expect(interactionSnapshot(redacted.snapshotBefore).interaction.title).toBeNull()
  })

  it('the former author no longer gets the own-content bypass once ownership has moved to someone else', () => {
    const NEW_OWNER = 'user-new-owner'
    const contextWithLiveAuthority = ctx({
      viewerUserId: OWNER,
      liveInteractionsById: new Map([
        [INTERACTION_ID, { visibility: 'private', authorUserId: NEW_OWNER, channelId: null, entityId: PERSON_ID }],
      ]),
    })
    const redacted = redactCustomerAuditEntry(revocationEntry(), contextWithLiveAuthority)
    expect(interactionSnapshot(redacted.snapshotBefore).interaction.title).toBeNull()
  })

  // Regression for @pkarw's follow-up review (pullrequestreview-5909263810,
  // finding 2): a snapshot missing its own `interaction.id` must NOT fall back
  // to trusting the stored `visibility` — that is exactly the unverifiable
  // historical signal this fix exists to stop trusting. With no id to resolve
  // (and no `entry.resourceId` fallback either), the conservative fallback
  // applies just like a deleted interaction would.
  it('fails closed when the snapshot carries no id and the entry has no resourceId to fall back to', () => {
    const entry = revocationEntry({
      resourceId: null,
      snapshotBefore: {
        interaction: {
          entityId: PERSON_ID,
          interactionType: 'email',
          visibility: 'shared',
          authorUserId: OWNER,
          title: 'Legacy shared subject',
        },
      },
      snapshotAfter: null,
      changesJson: null,
    })
    const redacted = redactCustomerAuditEntry(entry, ctx({ liveInteractionsById: new Map() }))
    expect(interactionSnapshot(redacted.snapshotBefore).interaction.title).toBeNull()
  })

  // Regression for the same finding: the audit row's own `resourceId` names
  // the exact same interaction the snapshot describes, so it is the correct
  // fallback identifier when the snapshot predates the `interaction.id` field.
  it("resolves live authority through the entry's resourceId when the snapshot itself has no id", () => {
    const entry = revocationEntry({
      resourceId: INTERACTION_ID,
      snapshotBefore: {
        interaction: {
          entityId: PERSON_ID,
          interactionType: 'email',
          visibility: 'shared',
          authorUserId: OWNER,
          title: 'Legacy shared subject',
        },
      },
      snapshotAfter: null,
      changesJson: null,
    })
    const liveAuthority = ctx({
      liveInteractionsById: new Map([
        [INTERACTION_ID, { visibility: 'private', authorUserId: OWNER, channelId: null, entityId: PERSON_ID }],
      ]),
    })
    const hiddenFromNonOwner = redactCustomerAuditEntry(entry, liveAuthority)
    expect(interactionSnapshot(hiddenFromNonOwner.snapshotBefore).interaction.title).toBeNull()

    const visibleToOwner = redactCustomerAuditEntry(entry, ctx({ ...liveAuthority, viewerUserId: OWNER }))
    expect(interactionSnapshot(visibleToOwner.snapshotBefore).interaction.title).toBe('Legacy shared subject')
  })

  // Regression for finding 1 of the same review: a share grant for the OLD
  // parent Person must not authorize a historical representation of an
  // interaction that has since moved to a different Person — only a grant for
  // the CURRENT (live) parent may widen access.
  describe('conversation shares after the interaction moved to a different parent', () => {
    const PERSON_B = 'person-2'

    it('does not widen access using a grant for the historical (no-longer-current) parent', () => {
      const liveAuthority = ctx({
        liveInteractionsById: new Map([
          [INTERACTION_ID, { visibility: 'private', authorUserId: OWNER, channelId: null, entityId: PERSON_B }],
        ]),
        // The owner shared their conversation with the OLD parent (PERSON_ID),
        // not the CURRENT one (PERSON_B) the interaction now belongs to.
        sharedConversations: [{ personEntityId: PERSON_ID, ownerUserId: OWNER }],
      })
      const redacted = redactCustomerAuditEntry(revocationEntry(), liveAuthority)
      expect(interactionSnapshot(redacted.snapshotBefore).interaction.title).toBeNull()
    })

    it('widens access using a grant for the CURRENT parent after the move', () => {
      const liveAuthority = ctx({
        liveInteractionsById: new Map([
          [INTERACTION_ID, { visibility: 'private', authorUserId: OWNER, channelId: null, entityId: PERSON_B }],
        ]),
        sharedConversations: [{ personEntityId: PERSON_B, ownerUserId: OWNER }],
      })
      const redacted = redactCustomerAuditEntry(revocationEntry(), liveAuthority)
      expect(interactionSnapshot(redacted.snapshotBefore).interaction.title).toBe('Old shared subject')
    })
  })
})

describe('redactCustomerAuditEntry — customers.person / customers.company delete snapshots', () => {
  function personDeleteEntry(interactions: Record<string, unknown>[]) {
    return {
      resourceKind: 'customers.person',
      snapshotBefore: {
        entity: { id: PERSON_ID },
        interactions,
      },
    }
  }

  it('fails closed: redacts an embedded email row with no visibility metadata when the viewer is not the author', () => {
    const entry = personDeleteEntry([
      { interactionType: 'email', authorUserId: OWNER, title: 'Secret', body: 'Secret body' },
    ])
    const redacted = redactCustomerAuditEntry(entry, ctx())
    const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
    expect(interactions[0].title).toBeNull()
    expect(interactions[0].body).toBeNull()
  })

  it('keeps the embedded email visible to its own author', () => {
    const entry = personDeleteEntry([
      { id: 'verified-interaction', interactionType: 'email', authorUserId: OWNER, title: 'Secret', body: 'Secret body' },
    ])
    const redacted = redactCustomerAuditEntry(entry, verifiedOwnerCtx())
    const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
    expect(interactions[0].title).toBe('Secret')
    expect(interactions[0].body).toBe('Secret body')
  })

  it('keeps the embedded email visible when a conversation share covers its CURRENT (live) parent', () => {
    const entry = personDeleteEntry([
      { id: 'embedded-interaction-1', interactionType: 'email', authorUserId: OWNER, title: 'Secret', body: 'Secret body' },
    ])
    const redacted = redactCustomerAuditEntry(
      entry,
      ctx({
        sharedConversations: [{ personEntityId: PERSON_ID, ownerUserId: OWNER }],
        liveInteractionsById: new Map([
          ['embedded-interaction-1', { visibility: 'private', authorUserId: OWNER, channelId: null, entityId: PERSON_ID }],
        ]),
      }),
    )
    const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
    expect(interactions[0].title).toBe('Secret')
  })

  // Regression for @pkarw's review on #8978 (pullrequestreview-5909481...) —
  // an interaction embedded in a Person/Company snapshot can move to a
  // DIFFERENT parent after this audit entry was recorded. A grant for the
  // historical (snapshot) parent must not authorize it; only a grant for the
  // interaction's CURRENT (live) parent may.
  it('does not widen access using a grant for the historical parent once the embedded interaction has moved', () => {
    const MOVED_TO = 'person-2'
    const entry = personDeleteEntry([
      { id: 'embedded-interaction-1', interactionType: 'email', authorUserId: OWNER, title: 'Secret', body: 'Secret body' },
    ])
    const redacted = redactCustomerAuditEntry(
      entry,
      ctx({
        // Grant covers the OLD parent (PERSON_ID) only.
        sharedConversations: [{ personEntityId: PERSON_ID, ownerUserId: OWNER }],
        liveInteractionsById: new Map([
          ['embedded-interaction-1', { visibility: 'private', authorUserId: OWNER, channelId: null, entityId: MOVED_TO }],
        ]),
      }),
    )
    const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
    expect(interactions[0].title).toBeNull()
  })

  it('fails closed (no widening) when the embedded interaction has no live record to resolve its current parent', () => {
    const entry = personDeleteEntry([
      { id: 'embedded-interaction-deleted', interactionType: 'email', authorUserId: OWNER, title: 'Secret', body: 'Secret body' },
    ])
    const redacted = redactCustomerAuditEntry(
      entry,
      ctx({
        sharedConversations: [{ personEntityId: PERSON_ID, ownerUserId: OWNER }],
        liveInteractionsById: new Map(),
      }),
    )
    const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
    expect(interactions[0].title).toBeNull()
  })

  // Regression for @pkarw's review on #8978 (pullrequestreview-5909684050) —
  // the embedded redactor used to permit ONLY the author or an explicit
  // conversation-share grant, silently ignoring a CURRENTLY `shared`
  // visibility and a current shared-mailbox channel — both of which make a
  // live CRM read, and a standalone `customers.interaction` audit entry for
  // the same email, fully visible. That mismatch over-redacted content a
  // non-owner viewer is actually authorized to see.
  it('keeps a CURRENTLY shared embedded email visible even with no author/grant match', () => {
    const entry = personDeleteEntry([
      { id: 'embedded-interaction-shared', interactionType: 'email', authorUserId: OWNER, title: 'Team-visible subject', body: 'Team-visible body' },
    ])
    const redacted = redactCustomerAuditEntry(
      entry,
      ctx({
        liveInteractionsById: new Map([
          ['embedded-interaction-shared', { visibility: 'shared', authorUserId: OWNER, channelId: null, entityId: PERSON_ID }],
        ]),
      }),
    )
    const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
    expect(interactions[0].title).toBe('Team-visible subject')
  })

  it('keeps an embedded private email visible through a CURRENTLY shared team-mailbox channel', () => {
    const entry = personDeleteEntry([
      { id: 'embedded-interaction-channel', interactionType: 'email', authorUserId: OWNER, title: 'Mailbox subject', body: 'Mailbox body' },
    ])
    const redacted = redactCustomerAuditEntry(
      entry,
      ctx({
        sharedChannelIds: ['channel-1'],
        liveInteractionsById: new Map([
          ['embedded-interaction-channel', { visibility: 'private', authorUserId: OWNER, channelId: 'channel-1', entityId: PERSON_ID }],
        ]),
      }),
    )
    const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
    expect(interactions[0].title).toBe('Mailbox subject')
  })

  it('hides an embedded private email once its shared-mailbox channel is no longer in the shared set (revoked)', () => {
    const entry = personDeleteEntry([
      { id: 'embedded-interaction-channel-revoked', interactionType: 'email', authorUserId: OWNER, title: 'Mailbox subject', body: 'Mailbox body' },
    ])
    const redacted = redactCustomerAuditEntry(
      entry,
      ctx({
        sharedChannelIds: [],
        liveInteractionsById: new Map([
          ['embedded-interaction-channel-revoked', { visibility: 'private', authorUserId: OWNER, channelId: 'channel-1', entityId: PERSON_ID }],
        ]),
      }),
    )
    const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
    expect(interactions[0].title).toBeNull()
  })

  // Regression for @pkarw's review on #8978 (pullrequestreview-5909526934) —
  // `customers.interactions.update` lets the existing author transfer
  // ownership to someone else. The embedded redactor used to match shares
  // against the snapshot's STORED (historical) authorUserId, so a grant made
  // for the OLD author kept authorizing content now owned by someone else
  // with no grant of their own, and the former owner's own-content bypass
  // could fire on content they no longer own.
  describe('ownership transfer (live authorUserId differs from the stored snapshot)', () => {
    const NEW_OWNER = 'user-new-owner'

    it("a grant for the OLD author does not authorize a non-owner once ownership transferred", () => {
      const entry = personDeleteEntry([
        { id: 'embedded-interaction-transferred', interactionType: 'email', authorUserId: OWNER, title: 'Secret', body: 'Secret body' },
      ])
      const redacted = redactCustomerAuditEntry(
        entry,
        ctx({
          // Grant only ever covered the OLD author.
          sharedConversations: [{ personEntityId: PERSON_ID, ownerUserId: OWNER }],
          liveInteractionsById: new Map([
            [
              'embedded-interaction-transferred',
              { visibility: 'private', authorUserId: NEW_OWNER, channelId: null, entityId: PERSON_ID },
            ],
          ]),
        }),
      )
      const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
      expect(interactions[0].title).toBeNull()
    })

    it('a grant for the NEW (current) author authorizes a non-owner after ownership transferred', () => {
      const entry = personDeleteEntry([
        { id: 'embedded-interaction-transferred', interactionType: 'email', authorUserId: OWNER, title: 'Secret', body: 'Secret body' },
      ])
      const redacted = redactCustomerAuditEntry(
        entry,
        ctx({
          sharedConversations: [{ personEntityId: PERSON_ID, ownerUserId: NEW_OWNER }],
          liveInteractionsById: new Map([
            [
              'embedded-interaction-transferred',
              { visibility: 'private', authorUserId: NEW_OWNER, channelId: null, entityId: PERSON_ID },
            ],
          ]),
        }),
      )
      const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
      expect(interactions[0].title).toBe('Secret')
    })

    it('the CURRENT (new) owner retains access to content they now own', () => {
      const entry = personDeleteEntry([
        { id: 'embedded-interaction-transferred', interactionType: 'email', authorUserId: OWNER, title: 'Secret', body: 'Secret body' },
      ])
      const redacted = redactCustomerAuditEntry(
        entry,
        ctx({
          viewerUserId: NEW_OWNER,
          liveInteractionsById: new Map([
            [
              'embedded-interaction-transferred',
              { visibility: 'private', authorUserId: NEW_OWNER, channelId: null, entityId: PERSON_ID },
            ],
          ]),
        }),
      )
      const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
      expect(interactions[0].title).toBe('Secret')
    })

    it('the FORMER owner no longer gets the own-content bypass once ownership has moved to someone else', () => {
      const entry = personDeleteEntry([
        { id: 'embedded-interaction-transferred', interactionType: 'email', authorUserId: OWNER, title: 'Secret', body: 'Secret body' },
      ])
      const redacted = redactCustomerAuditEntry(
        entry,
        ctx({
          viewerUserId: OWNER,
          liveInteractionsById: new Map([
            [
              'embedded-interaction-transferred',
              { visibility: 'private', authorUserId: NEW_OWNER, channelId: null, entityId: PERSON_ID },
            ],
          ]),
        }),
      )
      const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
      expect(interactions[0].title).toBeNull()
    })
  })

  it('leaves non-email embedded rows (calls, meetings) untouched', () => {
    const entry = personDeleteEntry([
      { interactionType: 'call', authorUserId: OWNER, title: 'Call notes', body: 'Call body' },
    ])
    const redacted = redactCustomerAuditEntry(entry, ctx())
    const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
    expect(interactions[0].title).toBe('Call notes')
  })

  it('defense-in-depth: redacts participants/linkedEntities on an embedded email row too, should they ever be present', () => {
    const entry = personDeleteEntry([
      {
        interactionType: 'email',
        authorUserId: OWNER,
        title: 'Secret',
        body: 'Secret body',
        participants: [{ userId: 'user-3', email: 'third@example.com' }],
        linkedEntities: [{ id: 'deal-1', type: 'deal', label: 'Confidential Deal' }],
      },
    ])
    const redacted = redactCustomerAuditEntry(entry, ctx())
    const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
    expect(interactions[0].participants).toBeNull()
    expect(interactions[0].linkedEntities).toBeNull()
  })

  it('redacts the custom-field snapshot on an embedded email row too', () => {
    const entry = personDeleteEntry([
      {
        interactionType: 'email',
        authorUserId: OWNER,
        title: 'Secret',
        body: 'Secret body',
        custom: { privateEmail: 'ghost@example.com' },
      },
    ])
    const redacted = redactCustomerAuditEntry(entry, ctx())
    const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
    expect(interactions[0].custom).toBeNull()
  })

  it('leaves the custom-field snapshot visible on an embedded email row for its own author', () => {
    const entry = personDeleteEntry([
      {
        id: 'verified-interaction',
        interactionType: 'email',
        authorUserId: OWNER,
        title: 'Secret',
        body: 'Secret body',
        custom: { privateEmail: 'ghost@example.com' },
      },
    ])
    const redacted = redactCustomerAuditEntry(entry, verifiedOwnerCtx())
    const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
    expect(interactions[0].custom).toEqual({ privateEmail: 'ghost@example.com' })
  })

  it('applies the same fail-closed rule to customers.company delete snapshots', () => {
    const entry = {
      resourceKind: 'customers.company',
      snapshotBefore: {
        entity: { id: PERSON_ID },
        interactions: [{ interactionType: 'email', authorUserId: OWNER, title: 'Secret', body: 'Secret body' }],
      },
    }
    const redacted = redactCustomerAuditEntry(entry, ctx())
    const interactions = embeddedInteractionsSnapshot(redacted.snapshotBefore).interactions
    expect(interactions[0].title).toBeNull()
  })
})

describe('redactCustomerAuditEntry — customers.person / customers.company changesJson.interactions diff', () => {
  function personUpdateEntry(overrides: Record<string, unknown> = {}) {
    return {
      resourceKind: 'customers.person',
      snapshotBefore: { entity: { id: PERSON_ID } },
      snapshotAfter: { entity: { id: PERSON_ID } },
      changesJson: {
        status: { from: 'lead', to: 'active' },
        interactions: {
          from: [{ id: 'verified-interaction', interactionType: 'email', authorUserId: OWNER, title: 'Old secret', body: 'Old secret body' }],
          to: [{ id: 'verified-interaction', interactionType: 'email', authorUserId: OWNER, title: 'New secret', body: 'New secret body' }],
        },
      },
      ...overrides,
    }
  }

  it('redacts an embedded email diff the viewer cannot see on either side', () => {
    const entry = personUpdateEntry()
    const redacted = redactCustomerAuditEntry(entry, ctx())
    const changes = redacted.changesJson as {
      status: unknown
      interactions: { from: InteractionFields[]; to: InteractionFields[] }
    }
    expect(changes.interactions.from[0].title).toBeNull()
    expect(changes.interactions.from[0].body).toBeNull()
    expect(changes.interactions.to[0].title).toBeNull()
    expect(changes.interactions.to[0].body).toBeNull()
    // unrelated field diffs are left untouched
    expect(changes.status).toEqual({ from: 'lead', to: 'active' })
  })

  it('leaves the embedded email diff visible to its own author', () => {
    const entry = personUpdateEntry()
    const redacted = redactCustomerAuditEntry(entry, verifiedOwnerCtx())
    const changes = redacted.changesJson as { interactions: { from: InteractionFields[]; to: InteractionFields[] } }
    expect(changes.interactions.from[0].title).toBe('Old secret')
    expect(changes.interactions.to[0].title).toBe('New secret')
  })

  it('applies the same redaction to customers.company update diffs', () => {
    const entry = {
      resourceKind: 'customers.company',
      snapshotBefore: { entity: { id: PERSON_ID } },
      snapshotAfter: { entity: { id: PERSON_ID } },
      changesJson: {
        interactions: {
          from: [{ interactionType: 'email', authorUserId: OWNER, title: 'Secret', body: 'Secret body' }],
          to: [{ interactionType: 'email', authorUserId: OWNER, title: 'Secret', body: 'Secret body' }],
        },
      },
    }
    const redacted = redactCustomerAuditEntry(entry, ctx())
    const changes = redacted.changesJson as { interactions: { from: InteractionFields[]; to: InteractionFields[] } }
    expect(changes.interactions.from[0].title).toBeNull()
    expect(changes.interactions.to[0].title).toBeNull()
  })

  it('leaves a changesJson with no interactions key untouched', () => {
    const entry = personUpdateEntry({ changesJson: { status: { from: 'lead', to: 'active' } } })
    const redacted = redactCustomerAuditEntry(entry, ctx())
    expect(redacted.changesJson).toEqual({ status: { from: 'lead', to: 'active' } })
  })

  it('leaves a null changesJson untouched', () => {
    const entry = personUpdateEntry({ changesJson: null })
    const redacted = redactCustomerAuditEntry(entry, ctx())
    expect(redacted.changesJson).toBeNull()
  })
})

describe('loadCustomerAuditRedactionContext', () => {
  const scope = { tenantId: 'tenant-1', organizationId: null }

  it('resolves grants and shared channel ids for a real viewer', async () => {
    jest.spyOn(conversationShares, 'listGrantsForViewer').mockResolvedValue([
      { personEntityId: PERSON_ID, ownerUserId: OWNER },
    ])
    jest.spyOn(conversationShares, 'listSharedChannelIds').mockResolvedValue(['channel-1'])
    const result = await loadCustomerAuditRedactionContext(mockEm, scope, VIEWER)
    expect(result).toEqual({
      viewerUserId: VIEWER,
      sharedConversations: [{ personEntityId: PERSON_ID, ownerUserId: OWNER }],
      sharedChannelIds: ['channel-1'],
      liveInteractionsById: new Map(),
    })
  })

  it('fails closed to empty grants when the lookup throws', async () => {
    jest.spyOn(conversationShares, 'listGrantsForViewer').mockRejectedValue(new Error('db down'))
    jest.spyOn(conversationShares, 'listSharedChannelIds').mockResolvedValue([])
    const result = await loadCustomerAuditRedactionContext(mockEm, scope, VIEWER)
    expect(result).toEqual({
      viewerUserId: VIEWER,
      sharedConversations: [],
      sharedChannelIds: [],
      liveInteractionsById: new Map(),
    })
  })

  it('batch-loads live interaction authority only for customers.interaction entries', async () => {
    jest.spyOn(conversationShares, 'listGrantsForViewer').mockResolvedValue([])
    jest.spyOn(conversationShares, 'listSharedChannelIds').mockResolvedValue([])
    const loadLiveSpy = jest
      .spyOn(conversationShares, 'loadLiveInteractionAuthority')
      .mockResolvedValue(new Map([['int-1', { visibility: 'private', authorUserId: OWNER, channelId: null, entityId: null }]]))
    const result = await loadCustomerAuditRedactionContext(mockEm, scope, VIEWER, [
      { resourceKind: 'customers.interaction', resourceId: 'int-1' },
      { resourceKind: 'customers.person', resourceId: 'person-9' },
      { resourceKind: 'customers.interaction', resourceId: null },
    ])
    expect(loadLiveSpy).toHaveBeenCalledWith(mockEm, scope, ['int-1'])
    expect(result.liveInteractionsById.get('int-1')).toEqual({
      visibility: 'private',
      authorUserId: OWNER,
      channelId: null,
      entityId: null,
    })
  })

  // Regression for @pkarw's review on #8978 (pullrequestreview-5909526934,
  // pullrequestreview-5909403897) — embedded interactions in a
  // customers.person/customers.company entry's snapshots AND changesJson
  // diff all need their live authority preloaded too, deduplicated against
  // each other and against any standalone customers.interaction entries.
  it('collects and dedupes embedded interaction ids from both snapshots and both diff sides', async () => {
    jest.spyOn(conversationShares, 'listGrantsForViewer').mockResolvedValue([])
    jest.spyOn(conversationShares, 'listSharedChannelIds').mockResolvedValue([])
    const loadLiveSpy = jest.spyOn(conversationShares, 'loadLiveInteractionAuthority').mockResolvedValue(new Map())
    await loadCustomerAuditRedactionContext(mockEm, scope, VIEWER, [
      {
        resourceKind: 'customers.person',
        snapshotBefore: { entity: { id: PERSON_ID }, interactions: [{ id: 'embed-1' }, { id: 'embed-2' }] },
        snapshotAfter: { entity: { id: PERSON_ID }, interactions: [{ id: 'embed-2' }] },
        changesJson: {
          interactions: { from: [{ id: 'embed-3' }], to: [{ id: 'embed-1' }, { id: 'embed-4' }] },
        },
      },
      { resourceKind: 'customers.interaction', resourceId: 'embed-1' },
    ])
    const [, , calledIds] = loadLiveSpy.mock.calls[loadLiveSpy.mock.calls.length - 1]
    expect(new Set(calledIds)).toEqual(new Set(['embed-1', 'embed-2', 'embed-3', 'embed-4']))
  })
})
