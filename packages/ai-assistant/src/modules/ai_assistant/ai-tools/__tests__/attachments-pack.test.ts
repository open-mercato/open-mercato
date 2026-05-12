/**
 * Step 3.8 — `attachments.*` tool pack unit tests.
 *
 * Covers list happy/empty, read with/without extracted text, tenant
 * isolation on reads, transfer happy path, and the mutation flag on
 * `attachments.transfer_record_attachments`.
 */
const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class AttachmentStub {},
}))

jest.mock('@open-mercato/core/modules/attachments/lib/metadata', () => ({
  readAttachmentMetadata: (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return { tags: [], assignments: [] }
    const value = raw as Record<string, unknown>
    return {
      tags: Array.isArray(value.tags) ? (value.tags as string[]) : [],
      assignments: Array.isArray(value.assignments)
        ? (value.assignments as Array<Record<string, unknown>>)
        : [],
    }
  },
  mergeAttachmentMetadata: (raw: unknown, patch: Record<string, unknown>) => {
    const base =
      raw && typeof raw === 'object' ? ({ ...(raw as Record<string, unknown>) }) : ({} as Record<string, unknown>)
    return { ...base, ...patch }
  },
}))

import attachmentsAiTools from '../attachments-pack'

function findTool(name: string) {
  const tool = attachmentsAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

type Ctx = {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: { resolve: (name: string) => unknown }
  userFeatures: string[]
  isSuperAdmin: boolean
}

function makeCtx(overrides: Partial<Ctx> = {}): {
  ctx: Ctx
  em: { persist: jest.Mock; flush: jest.Mock }
} {
  const em: any = {
    persist: jest.fn(function (this: any) {
      return em
    }),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      throw new Error(`unexpected resolve ${name}`)
    }),
  }
  const ctx: Ctx = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container,
    userFeatures: ['attachments.view', 'attachments.manage'],
    isSuperAdmin: false,
    ...overrides,
  }
  return { ctx, em }
}

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'att-1',
    entityId: 'customers:customer_person_profile',
    recordId: 'person-1',
    fileName: 'passport.pdf',
    mimeType: 'application/pdf',
    fileSize: 2048,
    partitionCode: 'default',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    storageMetadata: null,
    content: null,
    createdAt: new Date('2026-04-18T10:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  findWithDecryptionMock.mockReset()
  findOneWithDecryptionMock.mockReset()
})

describe('attachments.list_record_attachments', () => {
  const tool = findTool('attachments.list_record_attachments')

  it('returns metadata-only items scoped by tenant + organization', async () => {
    findWithDecryptionMock.mockResolvedValue([
      makeRow(),
      makeRow({ id: 'att-2', fileName: 'photo.jpg', mimeType: 'image/jpeg', fileSize: 512 }),
    ])
    const { ctx } = makeCtx()
    const result = (await tool.handler(
      { entityType: 'customers:customer_person_profile', recordId: 'person-1' },
      ctx as any,
    )) as Record<string, unknown>
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    const callArgs = findWithDecryptionMock.mock.calls[0]
    expect(callArgs[2]).toMatchObject({
      entityId: 'customers:customer_person_profile',
      recordId: 'person-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result.total).toBe(2)
    const items = result.items as Array<Record<string, unknown>>
    expect(items[0]).toMatchObject({
      id: 'att-1',
      fileName: 'passport.pdf',
      mediaType: 'application/pdf',
      size: 2048,
    })
    expect(items[0]).not.toHaveProperty('url')
    expect(items[0]).not.toHaveProperty('signedUrl')
  })

  it('handles empty record gracefully', async () => {
    findWithDecryptionMock.mockResolvedValue([])
    const { ctx } = makeCtx()
    const result = (await tool.handler(
      { entityType: 'customers:customer_person_profile', recordId: 'nobody' },
      ctx as any,
    )) as Record<string, unknown>
    expect(result.total).toBe(0)
    expect(result.items).toEqual([])
  })

  it('throws when tenant context is missing', async () => {
    const { ctx } = makeCtx({ tenantId: null })
    await expect(
      tool.handler(
        { entityType: 'customers:customer_person_profile', recordId: 'person-1' },
        ctx as any,
      ),
    ).rejects.toThrow(/Tenant context/)
  })
})

describe('attachments.read_attachment', () => {
  const tool = findTool('attachments.read_attachment')

  it('returns extracted text only when includeExtractedText is true', async () => {
    const row = makeRow({ content: 'OCR TEXT HERE', id: 'att-77' })
    findOneWithDecryptionMock.mockResolvedValueOnce(row).mockResolvedValueOnce(row)
    const { ctx } = makeCtx()
    const withoutText = (await tool.handler(
      { attachmentId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' },
      ctx as any,
    )) as Record<string, unknown>
    expect(withoutText.found).toBe(true)
    expect(withoutText.hasExtractedText).toBe(true)
    expect(withoutText.extractedText).toBeNull()

    const withText = (await tool.handler(
      { attachmentId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8', includeExtractedText: true },
      ctx as any,
    )) as Record<string, unknown>
    expect(withText.extractedText).toBe('OCR TEXT HERE')
  })

  it('returns { found: false } when the attachment is not visible to the tenant', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(null)
    const { ctx } = makeCtx()
    const result = (await tool.handler(
      { attachmentId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' },
      ctx as any,
    )) as Record<string, unknown>
    expect(result.found).toBe(false)
  })

  it('always scopes the query by tenantId (and organization when set)', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const { ctx } = makeCtx({ tenantId: 'tenant-X', organizationId: 'org-X' })
    await tool.handler(
      { attachmentId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' },
      ctx as any,
    )
    const args = findOneWithDecryptionMock.mock.calls[0]
    expect(args[2]).toMatchObject({
      id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      tenantId: 'tenant-X',
      organizationId: 'org-X',
    })
  })
})

describe('attachments.transfer_record_attachments', () => {
  const tool = findTool('attachments.transfer_record_attachments')

  it('declares isMutation=true', () => {
    expect(tool.isMutation).toBe(true)
  })

  it('requires attachments.manage feature', () => {
    expect(tool.requiredFeatures).toEqual(['attachments.manage'])
  })

  it('moves matching attachments to the target record and persists', async () => {
    const row = makeRow({
      id: 'att-1',
      recordId: 'draft-1',
      storageMetadata: {
        assignments: [
          { type: 'customers:customer_person_profile', id: 'draft-1' },
        ],
      },
    })
    findWithDecryptionMock.mockResolvedValue([row])
    const { ctx, em } = makeCtx()
    const result = (await tool.handler(
      {
        fromEntityType: 'customers:customer_person_profile',
        fromRecordId: 'draft-1',
        toEntityType: 'customers:customer_person_profile',
        toRecordId: 'person-9',
      },
      ctx as any,
    )) as Record<string, unknown>
    expect(result.transferred).toBe(1)
    expect((row as Record<string, unknown>).recordId).toBe('person-9')
    const metadata = (row as Record<string, unknown>).storageMetadata as {
      assignments: Array<{ type: string; id: string }>
    }
    expect(metadata.assignments[0]).toMatchObject({
      type: 'customers:customer_person_profile',
      id: 'person-9',
    })
    expect(em.persist).toHaveBeenCalledWith([row])
    expect(em.flush).toHaveBeenCalled()
  })

  it('returns transferred: 0 when no matching attachments exist', async () => {
    findWithDecryptionMock.mockResolvedValue([])
    const { ctx, em } = makeCtx()
    const result = (await tool.handler(
      {
        fromEntityType: 'customers:customer_person_profile',
        fromRecordId: 'draft-x',
        toEntityType: 'customers:customer_person_profile',
        toRecordId: 'person-9',
      },
      ctx as any,
    )) as Record<string, unknown>
    expect(result.transferred).toBe(0)
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects cross-entity transfers', async () => {
    const { ctx } = makeCtx()
    await expect(
      tool.handler(
        {
          fromEntityType: 'a:b',
          fromRecordId: 'r1',
          toEntityType: 'c:d',
          toRecordId: 'r2',
        },
        ctx as any,
      ),
    ).rejects.toThrow(/fromEntityType and toEntityType to match/)
  })

  it('respects caller tenant + organization when querying', async () => {
    findWithDecryptionMock.mockResolvedValue([])
    const { ctx } = makeCtx({ tenantId: 'tenant-Z', organizationId: 'org-Z' })
    await tool.handler(
      {
        fromEntityType: 'x:y',
        fromRecordId: 'r1',
        toEntityType: 'x:y',
        toRecordId: 'r2',
      },
      ctx as any,
    )
    const args = findWithDecryptionMock.mock.calls[0]
    expect(args[2]).toMatchObject({
      entityId: 'x:y',
      recordId: 'r1',
      tenantId: 'tenant-Z',
      organizationId: 'org-Z',
    })
  })
})

describe('attachments-pack tool surface', () => {
  it('exports the three expected tools with correct flags', () => {
    const names = attachmentsAiTools.map((tool) => tool.name)
    expect(names).toEqual([
      'attachments.list_record_attachments',
      'attachments.read_attachment',
      'attachments.transfer_record_attachments',
    ])
    const readOnly = attachmentsAiTools.filter((tool) => tool.isMutation !== true)
    expect(readOnly.map((tool) => tool.name)).toEqual([
      'attachments.list_record_attachments',
      'attachments.read_attachment',
    ])
  })
})
