import type { EntityManager } from '@mikro-orm/postgresql'

// Stub the entity module: the real one pulls in @mikro-orm/core (ESM) which the
// unit-test transform does not handle. The service only uses the class as an
// opaque token passed to em.create/em.findAndCount, so a plain class suffices.
jest.mock('../../../data/entities', () => ({ GeneratedDocument: class GeneratedDocument {} }))

import { GeneratedDocument } from '../../../data/entities'
import { GenerationHistoryService, type CreateGeneratedDocumentInput } from '..'

const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }

function makeCreateInput(overrides: Partial<CreateGeneratedDocumentInput> = {}): CreateGeneratedDocumentInput {
  return {
    scope,
    templateId: 'sales-offer',
    templateLabel: 'Sales Offer',
    resourceKind: 'sales.quote',
    resourceId: 'quote-7',
    resourceLabel: 'Quote #7',
    generatedBy: 'user-1',
    ...overrides,
  }
}

describe('GenerationHistoryService.create', () => {
  it('creates a GeneratedDocument with the scope and defaults, then flushes', async () => {
    const created = {}
    const em = {
      create: jest.fn().mockReturnValue(created),
      persist: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
    } as unknown as EntityManager

    await expect(new GenerationHistoryService(em).create(makeCreateInput())).resolves.toBe(created)

    expect(em.create).toHaveBeenCalledWith(GeneratedDocument, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      resourceKind: 'sales.quote',
      resourceId: 'quote-7',
      resourceLabel: 'Quote #7',
      templateId: 'sales-offer',
      templateLabel: 'Sales Offer',
      format: 'pdf',
      mimeType: 'application/pdf',
      generatedBy: 'user-1',
    })
    expect(em.persist).toHaveBeenCalledWith(created)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('honors explicit format and mimeType overrides', async () => {
    const em = {
      create: jest.fn().mockReturnValue({}),
      persist: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
    } as unknown as EntityManager

    await new GenerationHistoryService(em).create(
      makeCreateInput({ format: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    )

    expect(em.create).toHaveBeenCalledWith(
      GeneratedDocument,
      expect.objectContaining({ format: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    )
  })

  it('propagates persistence errors to the caller', async () => {
    const em = {
      create: jest.fn().mockReturnValue({}),
      persist: jest.fn(),
      flush: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as EntityManager
    await expect(new GenerationHistoryService(em).create(makeCreateInput())).rejects.toThrow('db down')
  })
})

describe('GenerationHistoryService.listAndCount', () => {
  it('builds a scoped, ordered, paginated query and maps rows to DTOs', async () => {
    const generatedAt = new Date('2026-08-09T10:00:00.000Z')
    const row = {
      id: 'doc-1',
      resourceKind: 'sales.quote',
      resourceId: 'quote-7',
      resourceLabel: 'Quote #7',
      templateId: 'sales-offer',
      templateLabel: 'Sales Offer',
      format: 'pdf',
      generatedBy: 'user-1',
      generatedAt,
    }
    const findAndCount = jest.fn().mockResolvedValue([[row], 1])
    const em = { findAndCount } as unknown as EntityManager

    const result = await new GenerationHistoryService(em).listAndCount({ scope, page: 2, pageSize: 20 })

    expect(findAndCount).toHaveBeenCalledWith(
      GeneratedDocument,
      { organizationId: 'org-1', tenantId: 'tenant-1' },
      { orderBy: { generatedAt: 'DESC' }, limit: 20, offset: 20 },
    )
    expect(result).toEqual({
      items: [{ ...row, generatedAt: '2026-08-09T10:00:00.000Z' }],
      total: 1,
    })
  })

  it('adds resourceKind and resourceId filters to the where clause when provided', async () => {
    const findAndCount = jest.fn().mockResolvedValue([[], 0])
    const em = { findAndCount } as unknown as EntityManager

    await new GenerationHistoryService(em).listAndCount({
      scope,
      page: 1,
      pageSize: 10,
      resourceKind: 'sales.quote',
      resourceId: 'quote-7',
    })

    expect(findAndCount).toHaveBeenCalledWith(
      GeneratedDocument,
      { organizationId: 'org-1', tenantId: 'tenant-1', resourceKind: 'sales.quote', resourceId: 'quote-7' },
      expect.objectContaining({ limit: 10, offset: 0 }),
    )
  })
})
