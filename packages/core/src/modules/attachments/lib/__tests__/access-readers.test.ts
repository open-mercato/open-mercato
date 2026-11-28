import { tryGetModules } from '@open-mercato/shared/lib/modules/registry'
import { registerAttachmentAccessResolvers } from '../access-registry'
import { KNOWN_DIRECT_ATTACHMENT_READER_MODULES, listUnguardedAttachmentReaders } from '../access-readers'

jest.mock('@open-mercato/shared/lib/modules/registry', () => ({ tryGetModules: jest.fn() }))

const mockedTryGetModules = jest.mocked(tryGetModules)

function enableModules(...ids: string[]) {
  mockedTryGetModules.mockReturnValue(ids.map((id) => ({ id })) as ReturnType<typeof tryGetModules>)
}

beforeEach(() => {
  registerAttachmentAccessResolvers([])
  mockedTryGetModules.mockReset()
})
afterEach(() => registerAttachmentAccessResolvers([]))

describe('listUnguardedAttachmentReaders', () => {
  it('reports an enabled listed module that has not declared owner access enforcement', () => {
    enableModules('attachments', 'agent_orchestrator')
    expect(listUnguardedAttachmentReaders()).toEqual(['agent_orchestrator'])
  })

  it('does not report a listed module once it declares enforcement', () => {
    enableModules('attachments')
    registerAttachmentAccessResolvers([{ moduleId: 'agent_orchestrator', resolvers: [], enforcesOwnerAccessOnDirectReads: true }])
    expect(listUnguardedAttachmentReaders()).toEqual([])
  })

  it('does not report a listed module that is disabled', () => {
    enableModules('attachments', 'documents')
    expect(listUnguardedAttachmentReaders()).toEqual([])
  })

  it('never reports an unlisted module', () => {
    enableModules('attachments', 'documents', 'catalog')
    registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [] }])
    expect(listUnguardedAttachmentReaders()).toEqual([])
  })

  it('reports every listed module while modules are not registered', () => {
    mockedTryGetModules.mockReturnValue(null)
    expect(listUnguardedAttachmentReaders()).toEqual([...KNOWN_DIRECT_ATTACHMENT_READER_MODULES])
  })

  it('reports every listed module while the access registry is invalid', () => {
    enableModules('attachments', 'agent_orchestrator')
    registerAttachmentAccessResolvers([{ moduleId: 'agent_orchestrator', resolvers: [], enforcesOwnerAccessOnDirectReads: true }])
    expect(() => registerAttachmentAccessResolvers([{ moduleId: '', resolvers: [] }])).toThrow()
    expect(listUnguardedAttachmentReaders()).toEqual(['agent_orchestrator'])
  })

  it('records the declaration only for modules that set it to true', () => {
    enableModules('agent_orchestrator')
    registerAttachmentAccessResolvers([{ moduleId: 'agent_orchestrator', resolvers: [], enforcesOwnerAccessOnDirectReads: false }])
    expect(listUnguardedAttachmentReaders()).toEqual(['agent_orchestrator'])
  })
})
