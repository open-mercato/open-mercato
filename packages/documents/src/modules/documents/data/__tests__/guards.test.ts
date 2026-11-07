/** @jest-environment node */
import type { MutationGuard, MutationGuardInput } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_DOCUMENT_ID = '66666666-6666-4666-8666-666666666666'

type MockDocument = { id: string; archivedAt: Date | null }

const mockLoadScopedDocument = jest.fn()
const mockResolveLoadedDocumentUserAccess = jest.fn()

// Isolate the guard's own decision logic from the already-tested permission
// helpers (`resolvePermission`/`resolveLoadedDocumentUserAccess`/share
// resolution): mock the module they live in and assert only how the guard
// wires document loading + tier checks together.
jest.mock('../../lib/permissions', () => ({
  loadScopedDocument: (...args: unknown[]) => mockLoadScopedDocument(...args),
  resolveLoadedDocumentUserAccess: (...args: unknown[]) => mockResolveLoadedDocumentUserAccess(...args),
  hasTier: (tier: string | null, required: string) => {
    const rank: Record<string, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 }
    if (!tier) return false
    return rank[tier] >= rank[required]
  },
}))

const mockEm = { kind: 'em' }
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'em') return mockEm
      throw new Error(`unknown service: ${name}`)
    },
  })),
}))

const { guards } = require('../guards') as { guards: MutationGuard[] }

function guardById(id: string): MutationGuard {
  const found = guards.find((g) => g.id === id)
  if (!found) throw new Error(`Guard ${id} not registered`)
  return found
}

function makeInput(overrides: Partial<MutationGuardInput> = {}): MutationGuardInput {
  return {
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    resourceKind: 'attachments:attachment',
    resourceId: null,
    operation: 'create',
    requestMethod: 'POST',
    requestHeaders: new Headers(),
    mutationPayload: null,
    ...overrides,
  }
}

const guard = guardById('documents.attachment-owner-authorization')

describe('documents attachment-owner-authorization guard', () => {
  beforeEach(() => {
    mockLoadScopedDocument.mockReset()
    mockResolveLoadedDocumentUserAccess.mockReset()
  })

  it('passes through uploads with no documents:document target', async () => {
    const result = await guard.validate(makeInput({
      mutationPayload: { entityId: 'example:todo', recordId: 'r1', assignments: [{ type: 'example:todo', id: 'r1' }] },
    }))
    expect(result.ok).toBe(true)
    expect(mockLoadScopedDocument).not.toHaveBeenCalled()
  })

  it('denies when the primary owner is a document the caller cannot edit', async () => {
    mockLoadScopedDocument.mockResolvedValue({ id: DOCUMENT_ID, archivedAt: null } satisfies MockDocument)
    mockResolveLoadedDocumentUserAccess.mockResolvedValue('viewer')
    const result = await guard.validate(makeInput({
      mutationPayload: {
        entityId: 'documents:document',
        recordId: DOCUMENT_ID,
        assignments: [{ type: 'documents:document', id: DOCUMENT_ID }],
      },
    }))
    expect(result).toEqual({ ok: false, status: 403, message: 'Forbidden' })
  })

  it('allows an editor to upload against a document primary owner', async () => {
    mockLoadScopedDocument.mockResolvedValue({ id: DOCUMENT_ID, archivedAt: null } satisfies MockDocument)
    mockResolveLoadedDocumentUserAccess.mockResolvedValue('editor')
    const result = await guard.validate(makeInput({
      mutationPayload: {
        entityId: 'documents:document',
        recordId: DOCUMENT_ID,
        assignments: [{ type: 'documents:document', id: DOCUMENT_ID }],
      },
    }))
    expect(result).toEqual({ ok: true })
    expect(mockLoadScopedDocument).toHaveBeenCalledWith(
      mockEm,
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    )
    expect(mockResolveLoadedDocumentUserAccess).toHaveBeenCalledWith(
      mockEm,
      { id: DOCUMENT_ID, archivedAt: null },
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      USER_ID,
      expect.objectContaining({ resolve: expect.any(Function) }),
    )
  })

  it('denies a secondary assignment to a protected document even when the primary owner is unrelated', async () => {
    mockLoadScopedDocument.mockResolvedValue({ id: DOCUMENT_ID, archivedAt: null } satisfies MockDocument)
    mockResolveLoadedDocumentUserAccess.mockResolvedValue('commenter')
    const result = await guard.validate(makeInput({
      mutationPayload: {
        entityId: 'attachments:library',
        recordId: 'library-folder',
        assignments: [
          { type: 'attachments:library', id: 'library-folder' },
          { type: 'documents:document', id: DOCUMENT_ID },
        ],
      },
    }))
    expect(result).toEqual({ ok: false, status: 403, message: 'Forbidden' })
  })

  it('denies when the document does not exist or is outside the caller scope', async () => {
    mockLoadScopedDocument.mockResolvedValue(null)
    const result = await guard.validate(makeInput({
      mutationPayload: { entityId: 'documents:document', recordId: DOCUMENT_ID, assignments: [{ type: 'documents:document', id: DOCUMENT_ID }] },
    }))
    expect(result).toEqual({ ok: false, status: 403, message: 'Forbidden' })
    expect(mockResolveLoadedDocumentUserAccess).not.toHaveBeenCalled()
  })

  it('denies an archived document even for its owner', async () => {
    mockLoadScopedDocument.mockResolvedValue({ id: DOCUMENT_ID, archivedAt: new Date('2026-01-01T00:00:00.000Z') })
    const result = await guard.validate(makeInput({
      mutationPayload: { entityId: 'documents:document', recordId: DOCUMENT_ID, assignments: [{ type: 'documents:document', id: DOCUMENT_ID }] },
    }))
    expect(result).toEqual({ ok: false, status: 403, message: 'Forbidden' })
    expect(mockResolveLoadedDocumentUserAccess).not.toHaveBeenCalled()
  })

  it('checks every distinct protected target and fails closed on the first denial', async () => {
    mockLoadScopedDocument.mockImplementation(async (_em: unknown, id: string) => ({ id, archivedAt: null }))
    mockResolveLoadedDocumentUserAccess.mockImplementation(async (_em: unknown, document: { id: string }) =>
      document.id === DOCUMENT_ID ? 'editor' : 'viewer')
    const result = await guard.validate(makeInput({
      mutationPayload: {
        entityId: 'documents:document',
        recordId: DOCUMENT_ID,
        assignments: [
          { type: 'documents:document', id: DOCUMENT_ID },
          { type: 'documents:document', id: OTHER_DOCUMENT_ID },
        ],
      },
    }))
    expect(result).toEqual({ ok: false, status: 403, message: 'Forbidden' })
  })

  it('denies when the request carries no organization scope', async () => {
    const result = await guard.validate(makeInput({
      organizationId: null,
      mutationPayload: { entityId: 'documents:document', recordId: DOCUMENT_ID, assignments: [{ type: 'documents:document', id: DOCUMENT_ID }] },
    }))
    expect(result).toEqual({ ok: false, status: 403, message: 'Forbidden' })
    expect(mockLoadScopedDocument).not.toHaveBeenCalled()
  })
})
