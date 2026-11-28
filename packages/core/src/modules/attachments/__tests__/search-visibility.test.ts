import type { SearchResult, SearchResultVisibilityContext } from '@open-mercato/shared/modules/search'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback: string) => fallback })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

jest.mock('../lib/access-runner', () => ({
  createAttachmentAccessContext: jest.fn(() => ({ marker: 'access-context' })),
  evaluateAttachmentAccess: jest.fn(),
}))

import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { evaluateAttachmentAccess } from '../lib/access-runner'
import { DOCUMENT_SECTION_SEARCH_ENTITY_ID, filterVisibleDocumentSections, searchConfig } from '../search'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_ORG_ID = '44444444-4444-4444-8444-444444444444'
const SECTION_OPEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SECTION_DENIED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SECTION_ORPHAN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SECTION_OTHER_ORG = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const ATTACHMENT_OPEN = '55555555-5555-4555-8555-555555555555'
const ATTACHMENT_DENIED = '66666666-6666-4666-8666-666666666666'
const ATTACHMENT_OTHER_ORG = '77777777-7777-4777-8777-777777777777'

type Row = Record<string, unknown>

const sections: Row[] = [
  { id: SECTION_OPEN, attachmentId: ATTACHMENT_OPEN },
  { id: SECTION_DENIED, attachmentId: ATTACHMENT_DENIED },
  { id: SECTION_OTHER_ORG, attachmentId: ATTACHMENT_OTHER_ORG },
]
const attachments: Row[] = [
  { id: ATTACHMENT_OPEN, partitionCode: 'rulebooks', tenantId: TENANT_ID, organizationId: ORG_ID },
  { id: ATTACHMENT_DENIED, partitionCode: 'rulebooks', tenantId: TENANT_ID, organizationId: ORG_ID },
  { id: ATTACHMENT_OTHER_ORG, partitionCode: 'rulebooks', tenantId: TENANT_ID, organizationId: OTHER_ORG_ID },
]
const partitions: Row[] = [{ code: 'rulebooks', tenantId: null, isPublic: false }]

function result(recordId: string): SearchResult {
  return { entityId: DOCUMENT_SECTION_SEARCH_ENTITY_ID, recordId, score: 1, source: 'tokens', organizationId: ORG_ID }
}

function context(overrides: Partial<SearchResultVisibilityContext> = {}): SearchResultVisibilityContext {
  return {
    entityId: DOCUMENT_SECTION_SEARCH_ENTITY_ID,
    results: [SECTION_OPEN, SECTION_DENIED, SECTION_ORPHAN, SECTION_OTHER_ORG].map(result),
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    viewer: {
      auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
      container: { resolve: jest.fn(() => ({ marker: 'em' })) },
    },
    ...overrides,
  }
}

describe('document section search visibility', () => {
  beforeEach(() => {
    jest.mocked(findWithDecryption).mockReset().mockImplementation((async (_em: unknown, entity: { name: string }) => {
      if (entity.name === 'AttachmentDocumentSection') return sections
      if (entity.name === 'Attachment') return attachments
      if (entity.name === 'AttachmentPartition') return partitions
      return []
    }) as unknown as typeof findWithDecryption)
    jest.mocked(evaluateAttachmentAccess).mockReset().mockImplementation(async ({ attachment }) => (
      attachment.id === ATTACHMENT_DENIED
        ? { ok: false, status: 404, reason: 'document_not_found', protected: true }
        : { ok: true, protected: false }
    ))
  })

  it('is wired as the section entity result filter', () => {
    expect(searchConfig.entities[0]?.filterResults).toBe(filterVisibleDocumentSections)
  })

  it('keeps only sections whose attachment the viewer may open', async () => {
    const visible = await filterVisibleDocumentSections(context())
    expect(visible.map((entry) => entry.recordId)).toEqual([SECTION_OPEN])
    const calls = jest.mocked(evaluateAttachmentAccess).mock.calls.map(([input]) => input)
    expect(calls.map((input) => input.attachment.id).sort()).toEqual([ATTACHMENT_DENIED, ATTACHMENT_OPEN].sort())
    for (const input of calls) {
      expect(input).toMatchObject({ action: 'read', requireAuthForPublic: true, auth: { sub: 'user-1', orgId: ORG_ID } })
    }
  })

  it('evaluates access in the attachment organization when the caller may see it', async () => {
    const visible = await filterVisibleDocumentSections(context({ organizationId: null, organizationIds: [ORG_ID, OTHER_ORG_ID] }))
    expect(visible.map((entry) => entry.recordId)).toEqual([SECTION_OPEN, SECTION_OTHER_ORG])
    const otherOrgCall = jest.mocked(evaluateAttachmentAccess).mock.calls
      .map(([input]) => input)
      .find((input) => input.attachment.id === ATTACHMENT_OTHER_ORG)
    expect(otherOrgCall?.auth).toMatchObject({ orgId: OTHER_ORG_ID })
  })

  it('drops sections whose partition is missing', async () => {
    jest.mocked(findWithDecryption).mockImplementation((async (_em: unknown, entity: { name: string }) => {
      if (entity.name === 'AttachmentDocumentSection') return sections
      if (entity.name === 'Attachment') return attachments
      return []
    }) as unknown as typeof findWithDecryption)
    expect(await filterVisibleDocumentSections(context())).toEqual([])
    expect(evaluateAttachmentAccess).not.toHaveBeenCalled()
  })

  it('returns nothing for a caller from another tenant', async () => {
    const visible = await filterVisibleDocumentSections(context({
      viewer: { auth: { sub: 'user-2', tenantId: 'other-tenant', orgId: ORG_ID }, container: { resolve: jest.fn() } },
    }))
    expect(visible).toEqual([])
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  it('fails closed when the lookup throws or the container is missing', async () => {
    jest.mocked(findWithDecryption).mockRejectedValue(new Error('db down'))
    await expect(filterVisibleDocumentSections(context())).rejects.toThrow('db down')
    await expect(filterVisibleDocumentSections(context({
      viewer: { auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID } },
    }))).rejects.toThrow('[internal]')
  })
})
