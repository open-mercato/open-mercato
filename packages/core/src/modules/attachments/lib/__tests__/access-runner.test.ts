import type { AwilixContainer } from 'awilix'
import { applyAclFeatureOverrides, resetModuleContractOverridesForTests } from '@open-mercato/shared/modules/overrides'
import { createAttachmentAccessContext, evaluateAttachmentAccess } from '../access-runner'
import { registerAttachmentAccessResolvers } from '../access-registry'
import type { AttachmentAccessInput, AttachmentAccessResolver } from '../access-types'

jest.mock('../../data/entities', () => ({ Attachment: class {}, AttachmentPartition: class {} }))

const auth = { sub: 'user', tenantId: 'tenant', orgId: 'org', roles: ['admin'] }
const attachment = { id: 'file', entityId: 'documents:document', recordId: 'document', partitionCode: 'private', tenantId: 'tenant', organizationId: 'org', fileName: 'private.txt', mimeType: 'text/plain' }
const partition = { code: 'private', isPublic: false }
const requirement = { resolverId: 'documents.files', targetEntity: 'documents:document' }
const allow = jest.fn(async () => ({ ok: true as const }))
const rbac = {
  loadAcl: jest.fn(async () => ({ isSuperAdmin: false, organizations: ['org'] })),
  getEffectiveFeatures: jest.fn(async () => ['documents.view', 'attachments.view']),
}
const container = { resolve: jest.fn(() => rbac) } as unknown as AwilixContainer
const resolver = (changes: Partial<AttachmentAccessResolver> = {}): AttachmentAccessResolver => ({
  id: 'documents.files', targetPartition: '*', targetEntity: 'documents:document', resolve: allow, ...changes,
})
const evaluate = (changes: Partial<Parameters<typeof evaluateAttachmentAccess>[0]> = {}) => evaluateAttachmentAccess({
  auth, attachment, partition, action: 'read', requirePrivateReadFeature: true, context: createAttachmentAccessContext(container), ...changes,
})

beforeEach(() => {
  jest.clearAllMocks()
  rbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, organizations: ['org'] })
  rbac.getEffectiveFeatures.mockResolvedValue(['documents.view', 'attachments.view'])
  registerAttachmentAccessResolvers([])
})
afterEach(() => { registerAttachmentAccessResolvers([]); resetModuleContractOverridesForTests(); jest.useRealTimers() })

it('runs the immutable baseline before any negative-priority callback', async () => {
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [resolver({ priority: -999 })] }])
  expect(await evaluate({ auth: { ...auth, tenantId: 'foreign' } })).toMatchObject({ ok: false, status: 403 })
  expect(allow).not.toHaveBeenCalled()
  expect(container.resolve).not.toHaveBeenCalled()
})

it('preserves anonymous global public behavior when no owner policy applies', async () => {
  expect(await evaluate({ auth: null, attachment: { ...attachment, tenantId: null, organizationId: null }, partition: { ...partition, isPublic: true } })).toEqual({ ok: true, protected: false })
})

it('requires authentication for an adopted global public owner before invoking callbacks', async () => {
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [resolver()] }])
  expect(await evaluate({ auth: null, attachment: { ...attachment, tenantId: null, organizationId: null }, partition: { ...partition, isPublic: true } })).toMatchObject({ ok: false, status: 401, protected: true })
  expect(allow).not.toHaveBeenCalled()
})

it.each(['read', 'render', 'metadata', 'delete', 'reassign', 'export'] as const)('denies absent required provider for %s', async (action) => {
  registerAttachmentAccessResolvers([{ moduleId: 'other', resolvers: [resolver({ id: 'other.wildcard', targetEntity: '*' })] }])
  expect(await evaluate({ action, partition: { ...partition, accessResolverRequirements: [requirement] } })).toMatchObject({ ok: false, reason: 'required_resolver_missing' })
  expect(allow).not.toHaveBeenCalled()
})

it('cannot satisfy required-owner coverage through a different assignment or action', async () => {
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [resolver({ targetEntity: 'other:record' })] }])
  expect(await evaluate({
    attachment: { ...attachment, storageMetadata: { assignments: [{ type: 'other:record', id: 'other' }] } },
    partition: { ...partition, accessResolverRequirements: [requirement] },
  })).toMatchObject({ ok: false, reason: 'required_resolver_missing' })
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [resolver({ actions: ['read'] })] }])
  expect(await evaluate({ action: 'delete', partition: { ...partition, accessResolverRequirements: [requirement] } })).toMatchObject({ ok: false })
})

it('enforces whole-partition requirements even for an ownerless attachment', async () => {
  expect(await evaluate({ attachment: { ...attachment, entityId: '', recordId: '' }, partition: { ...partition, accessResolverRequirements: [{ ...requirement, targetEntity: '*' }] } })).toMatchObject({ ok: false })
})

it('rejects malformed policy and malformed protected owner without dropping them', async () => {
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [resolver()] }])
  expect(await evaluate({ partition: { ...partition, accessResolverRequirements: {} } })).toMatchObject({ ok: false, reason: 'invalid_requirements' })
  expect(await evaluate({ attachment: { ...attachment, recordId: '' }, partition: { ...partition, accessResolverRequirements: [requirement] } })).toMatchObject({ ok: false, reason: 'invalid_owner' })
})

it('retains unrelated owners in a protected shared partition', async () => {
  expect(await evaluate({ attachment: { ...attachment, entityId: 'sync_excel:upload' }, partition: { ...partition, accessResolverRequirements: [requirement] } })).toEqual({ ok: true, protected: true })
})

it('denies a protected service without a policy context', async () => {
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [resolver()] }])
  expect(await evaluate({ context: null })).toMatchObject({ ok: false, reason: 'policy_context_missing' })
})

it('uses current server features, freezes snapshots, and isolates each resolver cache', async () => {
  const observed: AttachmentAccessInput[] = []
  const first = resolver({ resolve: async (input) => {
    observed.push(input); input.cache.set('same-key', 'first')
    expect(Object.isFrozen(input)).toBe(true)
    expect(Object.isFrozen(input.attachment)).toBe(true)
    expect(Object.isFrozen(input.targets)).toBe(true)
    expect(input.subject.userFeatures).toEqual(['documents.view', 'attachments.view'])
    expect(input.subject.auth.features).toBeUndefined()
    expect(input.subject.auth.roles).toBeUndefined()
    expect(input.attachment).not.toHaveProperty('storageMetadata')
    return { ok: true }
  } })
  const second = resolver({ id: 'documents.second', resolve: async (input) => {
    expect(input.cache.has('same-key')).toBe(false); observed.push(input); return { ok: true }
  } })
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [first, second] }])
  const context = createAttachmentAccessContext(container)
  expect(await evaluate({ auth: { ...auth, features: ['*'], isSuperAdmin: true }, context })).toMatchObject({ ok: true, protected: true })
  await evaluate({ attachment: { ...attachment, recordId: 'destination' }, context })
  expect(observed.map((input) => input.targets[0].recordId)).toEqual(['document', 'document', 'destination', 'destination'])
  expect(rbac.loadAcl).toHaveBeenCalledTimes(1)
  expect(rbac.getEffectiveFeatures).toHaveBeenCalledTimes(1)
})

it('denies a stale token superadmin when the live subject cannot cross scope', async () => {
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [resolver()] }])
  expect(await evaluate({ auth: { ...auth, orgId: 'foreign', isSuperAdmin: true } })).toMatchObject({ ok: false, reason: 'current_scope' })
  expect(allow).not.toHaveBeenCalled()
})

it('stops on the first denial and never invokes later allows', async () => {
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [
    resolver({ priority: 1, resolve: async () => ({ ok: false, status: 404, reason: 'not_found' }) }),
    resolver({ id: 'documents.later', priority: 2 }),
  ] }])
  expect(await evaluate()).toMatchObject({ ok: false, status: 404 })
  expect(allow).not.toHaveBeenCalled()
})

it.each(['throw', 'malformed'])('fails closed for a %s callback', async (kind) => {
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [resolver({ resolve: async () => {
    if (kind === 'throw') throw new Error('sensitive provider detail')
    return { ok: true, extra: 'invalid' } as { ok: true }
  } })] }])
  expect(await evaluate()).toMatchObject({ ok: false, status: 403, reason: 'resolver_failed' })
})

it('bounds a callback, aborts it, and ignores its late allow', async () => {
  jest.useFakeTimers()
  let signal: AbortSignal | undefined
  let finish: ((value: { ok: true }) => void) | undefined
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [resolver({ timeoutMs: 20, resolve: async (input) => {
    signal = input.signal
    return new Promise((resolve) => { finish = resolve })
  } })] }])
  const pending = evaluate()
  await jest.advanceTimersByTimeAsync(25)
  expect(await pending).toMatchObject({ ok: false, status: 504 })
  expect(signal?.aborted).toBe(true)
  finish?.({ ok: true })
  expect(jest.getTimerCount()).toBe(0)
})

describe('private byte capability (#8760)', () => {
  it.each(['read', 'render'] as const)('denies %s without the current read feature despite token grants', async (action) => {
    rbac.getEffectiveFeatures.mockResolvedValue(['attachments.manage'])
    expect(await evaluate({ action, auth: { ...auth, features: ['*'] } })).toMatchObject({ ok: false, status: 403 })
  })

  it.each(['attachments.view', 'attachments.*', '*'])('accepts %s and marks feature-gated bytes as protected', async (feature) => {
    rbac.getEffectiveFeatures.mockResolvedValue([feature])
    expect(await evaluate()).toEqual({ ok: true, protected: true })
  })

  it('requires the read feature for global private bytes', async () => {
    rbac.getEffectiveFeatures.mockResolvedValue([])
    expect(await evaluate({ attachment: { ...attachment, tenantId: null, organizationId: null } })).toMatchObject({ ok: false, status: 403 })
  })

  it('preserves a live superadmin and rejects a revoked token superadmin', async () => {
    rbac.getEffectiveFeatures.mockResolvedValue([])
    rbac.loadAcl.mockResolvedValueOnce({ isSuperAdmin: true, organizations: [] })
    expect(await evaluate({ auth: { ...auth, tenantId: 'foreign', isSuperAdmin: true } })).toMatchObject({ ok: true })
    expect(await evaluate({ auth: { ...auth, isSuperAdmin: true } })).toMatchObject({ ok: false, status: 403 })
  })

  it('does not let a live superadmin override a removed read feature', async () => {
    applyAclFeatureOverrides({ 'attachments.view': null })
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: true, organizations: [] })
    rbac.getEffectiveFeatures.mockResolvedValue(['*'])
    expect(await evaluate({ auth: { ...auth, isSuperAdmin: true } })).toMatchObject({ ok: false, status: 403 })
  })

  it('fails closed without a live RBAC context for private bytes', async () => {
    expect(await evaluate({ context: null })).toMatchObject({ ok: false, status: 403 })
  })

  it('does not load RBAC for unadopted public partitions', async () => {
    rbac.getEffectiveFeatures.mockResolvedValue([])
    expect(await evaluate({ partition: { ...partition, isPublic: true } })).toEqual({ ok: true, protected: false })
    expect(container.resolve).not.toHaveBeenCalled()
  })

  it('preserves existing service callers that do not request the byte-route gate', async () => {
    rbac.getEffectiveFeatures.mockResolvedValue([])
    expect(await evaluate({ requirePrivateReadFeature: undefined })).toEqual({ ok: true, protected: false })
    expect(container.resolve).not.toHaveBeenCalled()
  })

  it.each(['metadata', 'delete', 'reassign', 'export'] as const)('preserves unadopted %s policy', async (action) => {
    rbac.getEffectiveFeatures.mockResolvedValue([])
    expect(await evaluate({ action })).toEqual({ ok: true, protected: false })
    expect(container.resolve).not.toHaveBeenCalled()
  })

  it('does not allow a feature grant to override an owner denial', async () => {
    registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [resolver({
      resolve: async () => ({ ok: false, status: 404, reason: 'owner_denied' }),
    })] }])
    expect(await evaluate()).toMatchObject({ ok: false, status: 404, reason: 'owner_denied' })
  })

  it('does not invoke owner callbacks when the private read feature is absent', async () => {
    rbac.getEffectiveFeatures.mockResolvedValue([])
    registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [resolver()] }])
    expect(await evaluate()).toMatchObject({ ok: false, status: 403 })
    expect(allow).not.toHaveBeenCalled()
  })
})
