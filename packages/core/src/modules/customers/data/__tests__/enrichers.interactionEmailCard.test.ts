import { interactionEmailCardEnricher } from '../enrichers'

type LinkRow = { id: string; channel_metadata: unknown }

function makeCtx(opts: { userId?: string | null; linkRows?: LinkRow[] }) {
  const builder: Record<string, unknown> = {
    selectFrom() { return builder },
    select() { return builder },
    where() { return builder },
    execute: () => Promise.resolve(opts.linkRows ?? []),
  }
  return {
    em: { getKysely: () => builder },
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: opts.userId ?? 'user-A',
    userFeatures: [],
  } as any
}

const LINK_META = {
  messageId: '<m1@x.com>',
  from: 'a@x.com',
  to: ['b@x.com'],
  cc: [],
  references: ['<r1@x.com>'],
  subject: 'Hi',
}

function emailRecord(over: Record<string, unknown> = {}) {
  return {
    id: 'i-1',
    interactionType: 'email',
    externalMessageId: 'link-1',
    visibility: 'private',
    authorUserId: 'user-A',
    ...over,
  }
}

describe('interactionEmailCardEnricher', () => {
  it('maps link metadata and flags the requesting user as author', async () => {
    const out = await interactionEmailCardEnricher.enrichMany!(
      [emailRecord()],
      makeCtx({ userId: 'user-A', linkRows: [{ id: 'link-1', channel_metadata: LINK_META }] }),
    )
    const email = (out[0] as any)._integrations.email
    expect(email).toMatchObject({
      externalMessageId: 'link-1',
      rfcMessageId: '<m1@x.com>',
      fromAddress: 'a@x.com',
      toAddresses: ['b@x.com'],
      ccAddresses: null,
      references: ['<r1@x.com>'],
      currentVisibility: 'private',
      isAuthor: true,
    })
  })

  it('does NOT enrich a PRIVATE email for a non-author (fail-closed)', async () => {
    // emailRecord() defaults to visibility:'private', authorUserId:'user-A'.
    const out = await interactionEmailCardEnricher.enrichMany!(
      [emailRecord()],
      makeCtx({ userId: 'user-B', linkRows: [{ id: 'link-1', channel_metadata: LINK_META }] }),
    )
    // Strict owner-only (v1): a private row is never enriched for a non-author,
    // so no subject/from/to leaks even if an upstream visibility filter is missing.
    expect((out[0] as any)._integrations).toBeUndefined()
  })

  it('enriches a SHARED email for a non-author with isAuthor=false', async () => {
    const out = await interactionEmailCardEnricher.enrichMany!(
      [emailRecord({ visibility: 'shared' })],
      makeCtx({ userId: 'user-B', linkRows: [{ id: 'link-1', channel_metadata: LINK_META }] }),
    )
    const email = (out[0] as any)._integrations.email
    expect(email.currentVisibility).toBe('shared')
    expect(email.isAuthor).toBe(false)
  })

  it('coerces an unrecognised visibility value to null', async () => {
    const out = await interactionEmailCardEnricher.enrichMany!(
      [emailRecord({ visibility: 'weird' })],
      makeCtx({ linkRows: [{ id: 'link-1', channel_metadata: LINK_META }] }),
    )
    expect((out[0] as any)._integrations.email.currentVisibility).toBeNull()
  })

  it('passes non-email records through untouched', async () => {
    const note = { id: 'i-note', interactionType: 'note' }
    const out = await interactionEmailCardEnricher.enrichMany!(
      [emailRecord(), note],
      makeCtx({ linkRows: [{ id: 'link-1', channel_metadata: LINK_META }] }),
    )
    expect((out[1] as any)._integrations).toBeUndefined()
  })

  it('leaves an email record unchanged when no matching link row exists', async () => {
    const out = await interactionEmailCardEnricher.enrichMany!(
      [emailRecord()],
      makeCtx({ userId: 'user-A', linkRows: [] }),
    )
    expect((out[0] as any)._integrations).toBeUndefined()
  })
})
