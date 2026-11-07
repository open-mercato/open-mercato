import { loadCustomerAuditRedactionContext, redactCustomerAuditEntry, type CustomerAuditRedactionContext } from '../auditRedaction'
import * as conversationShares from '../conversationShares'

const OWNER = 'user-owner'
const VIEWER = 'user-viewer'
const PERSON_ID = 'person-1'

function ctx(overrides: Partial<CustomerAuditRedactionContext> = {}): CustomerAuditRedactionContext {
  return {
    viewerUserId: VIEWER,
    sharedConversations: [],
    sharedChannelIds: [],
    ...overrides,
  }
}

describe('redactCustomerAuditEntry — customers.interaction', () => {
  function interactionEntry(overrides: Record<string, unknown> = {}) {
    return {
      resourceKind: 'customers.interaction',
      snapshotBefore: {
        interaction: {
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
    const redacted = redactCustomerAuditEntry(interactionEntry(), ctx())
    const interaction = (redacted.snapshotBefore as any).interaction
    expect(interaction.title).toBeNull()
    expect(interaction.body).toBeNull()
    // Non-content fields stay intact.
    expect(interaction.authorUserId).toBe(OWNER)
  })

  it('leaves title/body visible to the email author', () => {
    const redacted = redactCustomerAuditEntry(interactionEntry(), ctx({ viewerUserId: OWNER }))
    const interaction = (redacted.snapshotBefore as any).interaction
    expect(interaction.title).toBe('Private subject')
    expect(interaction.body).toBe('Private body')
  })

  it('leaves title/body visible when a conversation share grants the viewer access', () => {
    const redacted = redactCustomerAuditEntry(
      interactionEntry(),
      ctx({ sharedConversations: [{ personEntityId: PERSON_ID, ownerUserId: OWNER }] }),
    )
    const interaction = (redacted.snapshotBefore as any).interaction
    expect(interaction.title).toBe('Private subject')
    expect(interaction.body).toBe('Private body')
  })

  it('leaves legacy visibility:null rows visible (parity with the live CRM filter)', () => {
    const entry = interactionEntry({
      snapshotBefore: {
        interaction: {
          entityId: PERSON_ID,
          interactionType: 'email',
          visibility: null,
          authorUserId: OWNER,
          title: 'Legacy subject',
          body: 'Legacy body',
        },
      },
    })
    const redacted = redactCustomerAuditEntry(entry, ctx())
    const interaction = (redacted.snapshotBefore as any).interaction
    expect(interaction.title).toBe('Legacy subject')
    expect(interaction.body).toBe('Legacy body')
  })

  it('leaves non-email interactions untouched', () => {
    const entry = interactionEntry({
      snapshotBefore: {
        interaction: {
          entityId: PERSON_ID,
          interactionType: 'call',
          visibility: 'private',
          authorUserId: OWNER,
          title: 'Call notes',
          body: 'Call body',
        },
      },
    })
    const redacted = redactCustomerAuditEntry(entry, ctx())
    const interaction = (redacted.snapshotBefore as any).interaction
    expect(interaction.title).toBe('Call notes')
    expect(interaction.body).toBe('Call body')
  })

  it('strips title/body keys from the changes diff when the row is hidden', () => {
    const entry = interactionEntry({
      changesJson: { title: { from: 'old', to: 'new' }, body: { from: 'a', to: 'b' }, status: { from: 'planned', to: 'done' } },
    })
    const redacted = redactCustomerAuditEntry(entry, ctx())
    expect(redacted.changesJson).toEqual({ status: { from: 'planned', to: 'done' } })
  })

  it('passes through entries for resource kinds it does not own', () => {
    const entry = { resourceKind: 'sales.order', snapshotBefore: { foo: 'bar' } }
    expect(redactCustomerAuditEntry(entry, ctx())).toBe(entry)
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
    const interactions = (redacted.snapshotBefore as any).interactions
    expect(interactions[0].title).toBeNull()
    expect(interactions[0].body).toBeNull()
  })

  it('keeps the embedded email visible to its own author', () => {
    const entry = personDeleteEntry([
      { interactionType: 'email', authorUserId: OWNER, title: 'Secret', body: 'Secret body' },
    ])
    const redacted = redactCustomerAuditEntry(entry, ctx({ viewerUserId: OWNER }))
    const interactions = (redacted.snapshotBefore as any).interactions
    expect(interactions[0].title).toBe('Secret')
    expect(interactions[0].body).toBe('Secret body')
  })

  it('keeps the embedded email visible when a conversation share covers it', () => {
    const entry = personDeleteEntry([
      { interactionType: 'email', authorUserId: OWNER, title: 'Secret', body: 'Secret body' },
    ])
    const redacted = redactCustomerAuditEntry(
      entry,
      ctx({ sharedConversations: [{ personEntityId: PERSON_ID, ownerUserId: OWNER }] }),
    )
    const interactions = (redacted.snapshotBefore as any).interactions
    expect(interactions[0].title).toBe('Secret')
  })

  it('leaves non-email embedded rows (calls, meetings) untouched', () => {
    const entry = personDeleteEntry([
      { interactionType: 'call', authorUserId: OWNER, title: 'Call notes', body: 'Call body' },
    ])
    const redacted = redactCustomerAuditEntry(entry, ctx())
    const interactions = (redacted.snapshotBefore as any).interactions
    expect(interactions[0].title).toBe('Call notes')
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
    const interactions = (redacted.snapshotBefore as any).interactions
    expect(interactions[0].title).toBeNull()
  })
})

describe('loadCustomerAuditRedactionContext', () => {
  const scope = { tenantId: 'tenant-1', organizationId: null }

  it('resolves grants and shared channel ids for a real viewer', async () => {
    jest.spyOn(conversationShares, 'listGrantsForViewer').mockResolvedValue([
      { personEntityId: PERSON_ID, ownerUserId: OWNER },
    ])
    jest.spyOn(conversationShares, 'listSharedChannelIds').mockResolvedValue(['channel-1'])
    const result = await loadCustomerAuditRedactionContext({} as any, scope, VIEWER)
    expect(result).toEqual({
      viewerUserId: VIEWER,
      sharedConversations: [{ personEntityId: PERSON_ID, ownerUserId: OWNER }],
      sharedChannelIds: ['channel-1'],
    })
  })

  it('fails closed to empty grants when the lookup throws', async () => {
    jest.spyOn(conversationShares, 'listGrantsForViewer').mockRejectedValue(new Error('db down'))
    jest.spyOn(conversationShares, 'listSharedChannelIds').mockResolvedValue([])
    const result = await loadCustomerAuditRedactionContext({} as any, scope, VIEWER)
    expect(result).toEqual({ viewerUserId: VIEWER, sharedConversations: [], sharedChannelIds: [] })
  })
})
