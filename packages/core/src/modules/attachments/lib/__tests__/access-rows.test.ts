import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerAttachmentAccessResolvers } from '../access-registry'
import { buildAttachmentAccessAuth, evaluateAttachmentRowAccess, requiresAttachmentOwnerAccess } from '../access-rows'
import { createAttachmentAccessContext, evaluateAttachmentAccess } from '../access-runner'
import type { AttachmentAccessInput, AttachmentAccessResolver } from '../access-types'

jest.mock('../../data/entities', () => ({ Attachment: class {}, AttachmentPartition: class {} }))

const auth = { sub: 'user', userId: 'user', tenantId: 'tenant', orgId: 'org' }
const protectedRow = {
  id: 'protected', entityId: 'documents:document', recordId: 'document', partitionCode: 'private',
  tenantId: 'tenant', organizationId: 'org', fileName: 'secret.pdf', mimeType: 'application/pdf',
}
const plainRow = { ...protectedRow, id: 'plain', entityId: 'customers:customer_person_profile', recordId: 'person' }
const partition = { code: 'private', isPublic: false, tenantId: null, organizationId: null, accessResolverRequirements: [] }

const resolve = jest.fn(async (input: AttachmentAccessInput) => (
  input.subject.userFeatures.includes('documents.view') ? { ok: true as const } : { ok: false as const, status: 404 as const, reason: 'hidden' }
))
const resolver = (changes: Partial<AttachmentAccessResolver> = {}): AttachmentAccessResolver => ({
  id: 'documents.files', targetPartition: '*', targetEntity: 'documents:document', resolve, ...changes,
})

function setup(features: string[]) {
  const rbac = {
    loadAcl: jest.fn(async () => ({ isSuperAdmin: false, organizations: ['org'] })),
    getEffectiveFeatures: jest.fn(async () => features),
  }
  const em = { find: jest.fn(async () => [partition]) } as unknown as EntityManager
  const container = { resolve: jest.fn((name: string) => (name === 'em' ? em : rbac)) } as unknown as AwilixContainer
  return { container, em, rbac }
}

beforeEach(() => {
  jest.clearAllMocks()
  registerAttachmentAccessResolvers([{
    moduleId: 'documents',
    resolvers: [resolver()],
    protectedTargets: [{ resolverId: 'documents.files', targetPartition: '*', targetEntity: 'documents:document' }],
  }])
})
afterEach(() => registerAttachmentAccessResolvers([]))

it('denies a protected row to a principal the owner resolver refuses and keeps unprotected rows', async () => {
  const { container } = setup([])
  const result = await evaluateAttachmentRowAccess({ container, auth, rows: [protectedRow, plainRow], action: 'read' })
  expect(result.allowed.map((row) => row.id)).toEqual(['plain'])
  expect(result.denied.map((row) => row.id)).toEqual(['protected'])
})

it('allows a protected row when the owner resolver allows the principal', async () => {
  const { container } = setup(['documents.view'])
  const result = await evaluateAttachmentRowAccess({ container, auth, rows: [protectedRow], action: 'read' })
  expect(result.allowed.map((row) => row.id)).toEqual(['protected'])
})

it('denies protected rows without a principal but leaves unprotected rows untouched', async () => {
  const { container, rbac } = setup(['documents.view'])
  const result = await evaluateAttachmentRowAccess({ container, auth: null, rows: [protectedRow, plainRow], action: 'read' })
  expect(result.allowed.map((row) => row.id)).toEqual(['plain'])
  expect(result.denied.map((row) => row.id)).toEqual(['protected'])
  expect(rbac.getEffectiveFeatures).not.toHaveBeenCalled()
})

it('refuses a reassignment that moves an unprotected row into a protected owner', async () => {
  const { container } = setup([])
  const result = await evaluateAttachmentRowAccess({
    container, auth, rows: [plainRow], action: 'reassign',
    destination: { entityId: 'documents:document', recordId: 'document' },
  })
  expect(result.denied.map((row) => row.id)).toEqual(['plain'])
})

it('protects rows referenced through an assignment, not only through the primary owner', async () => {
  const { container } = setup([])
  const assigned = {
    ...plainRow, id: 'assigned',
    storageMetadata: { assignments: [{ type: 'documents:document', id: 'document' }] },
  }
  const result = await evaluateAttachmentRowAccess({ container, auth, rows: [assigned], action: 'metadata' })
  expect(result.denied.map((row) => row.id)).toEqual(['assigned'])
})

it('denies a protected row whose partition cannot be loaded but keeps an unprotected one', async () => {
  const { container, em } = setup(['documents.view'])
  ;(em.find as jest.Mock).mockResolvedValueOnce([])
  const result = await evaluateAttachmentRowAccess({ container, auth, rows: [protectedRow, plainRow], action: 'read' })
  expect(result.allowed.map((row) => row.id)).toEqual(['plain'])
  expect(result.denied.map((row) => row.id)).toEqual(['protected'])
})

it('evaluates key-authenticated calls as the key, without the creator as a backing user', () => {
  expect(buildAttachmentAccessAuth({ tenantId: 'tenant', organizationId: 'org', userId: 'creator', apiKeyId: 'key-1' }))
    .toEqual({ sub: 'api_key:key-1', isApiKey: true, keyId: 'key-1', tenantId: 'tenant', orgId: 'org' })
  expect(buildAttachmentAccessAuth({ tenantId: 'tenant', organizationId: 'org', userId: 'user' }))
    .toMatchObject({ sub: 'user', userId: 'user' })
  expect(buildAttachmentAccessAuth({ tenantId: 'tenant', organizationId: 'org' })).toBeNull()
})

it('treats an authenticated api_key subject as the key, with or without an explicit key id', () => {
  const fromSubject = buildAttachmentAccessAuth({ tenantId: 'tenant', organizationId: 'org', userId: 'api_key:key-1' })
  expect(fromSubject).toEqual({ sub: 'api_key:key-1', isApiKey: true, keyId: 'key-1', tenantId: 'tenant', orgId: 'org' })
  const explicit = buildAttachmentAccessAuth({ tenantId: 'tenant', organizationId: 'org', userId: 'api_key:key-1', apiKeyId: 'key-1' })
  expect(explicit).toEqual(fromSubject)
  expect(buildAttachmentAccessAuth({ tenantId: 'tenant', organizationId: null, userId: 'user', isSuperAdmin: true }))
    .toEqual({ sub: 'user', userId: 'user', tenantId: 'tenant', orgId: null, isSuperAdmin: true })
})

it('evaluates an API key with the key\'s own features, not its creator\'s', async () => {
  const { container, rbac } = setup([])
  const keyAuth = buildAttachmentAccessAuth({ tenantId: 'tenant', organizationId: 'org', userId: 'creator', apiKeyId: 'key-1' })
  const result = await evaluateAttachmentRowAccess({ container, auth: keyAuth, rows: [protectedRow], action: 'read' })
  expect(result.denied.map((row) => row.id)).toEqual(['protected'])
  expect(rbac.getEffectiveFeatures).toHaveBeenCalledWith('api_key:key-1', expect.anything())
})

it('evaluates a transfer destination with assignments moved off the source record when asked', async () => {
  const { container } = setup(['documents.view'])
  const assigned = { ...protectedRow, storageMetadata: { assignments: [{ type: 'documents:document', id: 'document' }] } }
  const destination = { entityId: 'documents:document', recordId: 'document-2' }
  const targetIds = () => resolve.mock.calls.map(([input]) => input.targets.map((target) => target.recordId).sort())

  await evaluateAttachmentRowAccess({ container, auth, rows: [assigned], action: 'reassign', destination })
  expect(targetIds()[1]).toEqual(['document', 'document-2'])

  resolve.mockClear()
  await evaluateAttachmentRowAccess({ container, auth, rows: [assigned], action: 'reassign', destination: { ...destination, moveAssignments: true } })
  expect(targetIds()[1]).toEqual(['document-2'])
})

describe('protection detection parity with evaluateAttachmentAccess', () => {
  const scenarios: Array<{ name: string; entries: Parameters<typeof registerAttachmentAccessResolvers>[0]; row: typeof protectedRow & { storageMetadata?: unknown }; requirements?: unknown; action: 'read' | 'reassign'; invalidRegistry?: boolean }> = [
    { name: 'no policy at all', entries: [], row: plainRow, action: 'read' },
    { name: 'protected target on the primary owner', entries: [{ moduleId: 'documents', resolvers: [resolver()], protectedTargets: [{ resolverId: 'documents.files', targetPartition: '*', targetEntity: 'documents:document' }] }], row: protectedRow, action: 'read' },
    { name: 'resolver without a protected target', entries: [{ moduleId: 'documents', resolvers: [resolver()] }], row: protectedRow, action: 'read' },
    { name: 'resolver limited to other actions', entries: [{ moduleId: 'documents', resolvers: [resolver({ actions: ['delete'] })] }], row: protectedRow, action: 'read' },
    { name: 'resolver on another partition', entries: [{ moduleId: 'documents', resolvers: [resolver({ targetPartition: 'other' })] }], row: protectedRow, action: 'read' },
    { name: 'durable partition requirement only', entries: [{ moduleId: 'documents', resolvers: [resolver()] }], row: protectedRow, requirements: [{ resolverId: 'documents.files', targetEntity: 'documents:document' }], action: 'reassign' },
    { name: 'policy on another owner', entries: [{ moduleId: 'documents', resolvers: [resolver()], protectedTargets: [{ resolverId: 'documents.files', targetPartition: '*', targetEntity: 'documents:document' }] }], row: plainRow, action: 'read' },
    { name: 'protected owner reached only through an assignment', entries: [{ moduleId: 'documents', resolvers: [resolver()], protectedTargets: [{ resolverId: 'documents.files', targetPartition: '*', targetEntity: 'documents:document' }] }], row: { ...plainRow, storageMetadata: { assignments: [{ type: 'documents:document', id: 'document' }] } }, action: 'read' },
    { name: 'unparsable partition requirements', entries: [], row: plainRow, requirements: [{ resolverId: 42 }], action: 'read' },
    { name: 'invalid registry', entries: [], row: plainRow, action: 'read', invalidRegistry: true },
  ]
  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      registerAttachmentAccessResolvers(scenario.entries)
      if (scenario.invalidRegistry) {
        expect(() => registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [resolver({ id: 'other.files' })] }])).toThrow()
      }
      const { container } = setup(['documents.view'])
      const scenarioPartition = { ...partition, accessResolverRequirements: scenario.requirements ?? [] }
      const result = await evaluateAttachmentAccess({
        auth, attachment: scenario.row, partition: scenarioPartition, action: scenario.action,
        context: createAttachmentAccessContext(container),
      })
      expect(requiresAttachmentOwnerAccess(scenario.row, scenarioPartition, scenario.action)).toBe(result.protected)
    })
  }
})
