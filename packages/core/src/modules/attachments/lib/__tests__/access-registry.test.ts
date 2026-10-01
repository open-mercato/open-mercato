import {
  collectAttachmentAccessTargets,
  getAttachmentAccessRegistry,
  matchesAttachmentAccessResolver,
  matchesAttachmentAccessTargets,
  registerAttachmentAccessResolvers,
} from '../access-registry'
import type { AttachmentAccessRecord, AttachmentAccessResolver } from '../access-types'

function resolver(id: string, overrides: Partial<AttachmentAccessResolver> = {}): AttachmentAccessResolver {
  return { id, targetPartition: '*', resolve: async () => ({ ok: true }), ...overrides }
}

const record: AttachmentAccessRecord = {
  id: 'attachment-1', entityId: 'documents:document', recordId: 'document-1',
  partitionCode: 'privateAttachments', fileName: 'document.pdf', mimeType: 'application/pdf',
}

beforeEach(() => registerAttachmentAccessResolvers([]))
afterEach(() => registerAttachmentAccessResolvers([]))

describe('attachment access registry', () => {
  it('orders by priority, then module and declaration order without replacing matched policies', () => {
    registerAttachmentAccessResolvers([
      { moduleId: 'documents', resolvers: [resolver('documents.second'), resolver('documents.first', { priority: -5 })] },
      { moduleId: 'clinical', resolvers: [resolver('clinical.first'), resolver('clinical.second')] },
    ])
    expect(getAttachmentAccessRegistry().resolvers.map((entry) => entry.id)).toEqual([
      'documents.first', 'documents.second', 'clinical.first', 'clinical.second',
    ])
  })

  it('replaces a repeated full bootstrap atomically and freezes its declarations', () => {
    const actions: Array<'read'> = ['read']
    const entry = { moduleId: 'documents', resolvers: [resolver('documents.files', { actions })] }
    registerAttachmentAccessResolvers([entry])
    actions.length = 0
    expect(getAttachmentAccessRegistry().resolvers[0].actions).toEqual(['read'])
    registerAttachmentAccessResolvers([{ ...entry, resolvers: [resolver('documents.files', { actions: ['read'] })] }])
    expect(getAttachmentAccessRegistry().resolvers).toHaveLength(1)
  })

  it('supports a protection declaration whose resolver is currently absent', () => {
    registerAttachmentAccessResolvers([{
      moduleId: 'documents', resolvers: [],
      protectedTargets: [{ resolverId: 'documents.files', targetPartition: '*', targetEntity: 'documents:document' }],
    }])
    expect(getAttachmentAccessRegistry().protectedTargets).toHaveLength(1)
  })

  it.each([
    [{ moduleId: 'documents', resolvers: [resolver('documents.same'), resolver('documents.same')] }],
    [{ moduleId: 'other', resolvers: [resolver('documents.files')] }],
    [{ moduleId: 'documents', resolvers: [resolver('documents.files', { timeoutMs: 0 })] }],
    [{ moduleId: 'documents', resolvers: [resolver('documents.files', { targetPartition: 'private*' })] }],
    [{ moduleId: 'documents', resolvers: [{ ...resolver('documents.files'), features: ['documents.view'] }] }],
    [{ moduleId: 'other', resolvers: [], protectedTargets: [{ resolverId: 'documents.files', targetPartition: '*', targetEntity: '*' }] }],
  ])('fails closed on invalid/duplicate registration %#', (entry) => {
    registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [resolver('documents.previous')] }])
    expect(() => registerAttachmentAccessResolvers([entry])).toThrow()
    expect(getAttachmentAccessRegistry()).toEqual({ invalid: true, resolvers: [], protectedTargets: [] })
  })
})

describe('attachment owner matching', () => {
  it('matches partition and owner together, including declared action restrictions', () => {
    const policy = resolver('documents.files', {
      targetPartition: 'privateAttachments', targetEntity: 'documents:document', actions: ['read'],
    })
    const targets = collectAttachmentAccessTargets(record)
    expect(matchesAttachmentAccessResolver(policy, 'privateAttachments', targets, 'read')).toBe(true)
    expect(matchesAttachmentAccessResolver(policy, 'productsMedia', targets, 'read')).toBe(false)
    expect(matchesAttachmentAccessResolver(policy, 'privateAttachments', targets, 'delete')).toBe(false)
    expect(matchesAttachmentAccessResolver(policy, 'privateAttachments', collectAttachmentAccessTargets({ ...record, entityId: 'sync_excel:upload' }), 'read')).toBe(false)
  })

  it('keeps primary and normalized legacy object/array assignments without losing malformed owners', () => {
    expect(collectAttachmentAccessTargets({
      ...record,
      storageMetadata: { assignments: [{ type: 'documents:document', id: 'document-1' }, { type: ' clinical.patient ', id: ' patient-2 ' }, null, { type: 'documents:document', id: null }] },
    })).toEqual([
      { entityId: 'documents:document', recordId: 'document-1', origin: 'primary' },
      { entityId: 'clinical.patient', recordId: 'patient-2', origin: 'assignment' },
      { entityId: 'documents:document', recordId: '', origin: 'assignment' },
    ])
    expect(collectAttachmentAccessTargets({ ...record, entityId: 'sync_excel:upload', storageMetadata: { assignments: { type: ' documents:document ', id: '' } } })).toContainEqual({
      entityId: 'documents:document', recordId: '', origin: 'assignment',
    })
  })

  it('honors only terminal namespace wildcards and whole-partition protection with no targets', () => {
    const targets = collectAttachmentAccessTargets({ ...record, entityId: 'clinical.patient' })
    expect(matchesAttachmentAccessTargets('clinical.*', targets)).toBe(true)
    expect(matchesAttachmentAccessTargets('clinical*', targets)).toBe(false)
    expect(matchesAttachmentAccessTargets('clin.*', targets)).toBe(false)
    expect(matchesAttachmentAccessTargets('*', [])).toBe(true)
  })
})
