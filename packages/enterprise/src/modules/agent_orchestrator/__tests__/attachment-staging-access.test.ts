import { asValue, createContainer } from 'awilix'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { register as registerAttachments } from '@open-mercato/core/modules/attachments/di'
import { AttachmentStorageConfigurationError, registerAttachmentAccessResolvers, type AttachmentService } from '@open-mercato/core/modules/attachments'
import { Document, DocumentShare } from '../../../../../documents/src/modules/documents/data/entities'
import { attachmentAccessResolvers, protectedAttachmentTargets } from '../../../../../documents/src/modules/documents/data/attachment-access'
import { OpenCodeAgentRunner, type OpenCodeRunnerClient } from '../lib/runtime/openCodeAgentRunner'
import { registerLoggerExtension } from '@open-mercato/shared/lib/logger'
import { registerTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { InMemoryAgentRunSessionStore } from '../lib/runtime/agentRunSessionStore'
import { stageAttachments } from '../lib/runtime/attachmentStager'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'

jest.mock('node:fs/promises', () => ({ writeFile: jest.fn(async () => undefined), readdir: jest.fn(async () => []) }))
jest.mock('#generated/entities.ids.generated', () => jest.requireActual('../../../../../core/jest.mocks/entities.ids.generated.js'), { virtual: true })
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (em: EntityManager, ...args: Parameters<EntityManager['findOne']>) => em.findOne(...args),
  findWithDecryption: async (em: EntityManager, ...args: Parameters<EntityManager['find']>) => em.find(...args),
}))
jest.mock('../../../../../documents/src/modules/documents/data/entities', () => ({
  Document: class Document {}, DocumentShare: class DocumentShare {},
}))
jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  generateSessionToken: () => 'sess_attachment_access',
  createSessionApiKey: jest.fn(async () => undefined),
  deleteSessionApiKey: jest.fn(async () => undefined),
}))

import { deleteSessionApiKey } from '@open-mercato/core/modules/api_keys/services/apiKeyService'

const userId = '10000000-0000-4000-8000-000000000001'
const otherUserId = '10000000-0000-4000-8000-000000000002'
const documentId = '20000000-0000-4000-8000-000000000001'
const attachmentId = '30000000-0000-4000-8000-000000000001'
const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const files = { attachments: [{ attachmentId, ocrText: true }] }
const entry = {
  id: 'test.attachment_access', moduleId: 'test', runtime: 'opencode', resultKind: 'research',
  label: 'Attachment access test', description: 'Attachment access test', instructions: '',
  schema: z.object({ kind: z.literal('research'), data: z.object({}) }),
  tools: [], skills: [], subAgents: [], loop: { maxSteps: 1 }, files: { enabled: true },
} satisfies AgentRegistryEntry

function harness(options: { ownerUserId?: string; attachmentScope?: typeof scope; shared?: boolean; assignment?: boolean } = {}) {
  const attachment = {
    id: attachmentId, ...scope, ...options.attachmentScope,
    entityId: options.assignment ? 'example:record' : 'documents:document',
    recordId: options.assignment ? 'record-1' : documentId,
    storageMetadata: options.assignment ? { assignments: [{ type: 'documents:document', id: documentId }] } : {},
    partitionCode: 'privateAttachments', storagePath: 'secret-storage-path',
    fileName: 'private.txt', mimeType: 'text/plain', content: 'secret-ocr-content',
  }
  const partition = {
    code: 'privateAttachments', isPublic: false,
    accessResolverRequirements: [{ resolverId: 'documents.document-attachments', targetEntity: 'documents:document' }],
  }
  const em = {
    fork: () => em,
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === AttachmentPartition) return partition
      if (where.tenantId !== scope.tenantId || where.organizationId !== scope.organizationId) throw new Error('unscoped query')
      if (entity === Attachment) return attachment.tenantId === where.tenantId && attachment.organizationId === where.organizationId ? attachment : null
      if (entity === Document && where.id === documentId) return { id: documentId, ownerUserId: options.ownerUserId ?? otherUserId, archivedAt: null }
      return null
    }),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === DocumentShare) {
        expect(where).toMatchObject({ documentId, ...scope, deletedAt: null, $or: [{ principalType: 'user', principalId: userId }] })
        return options.shared ? [{ permission: 'viewer' }] : []
      }
      return []
    }),
  }
  const read = jest.fn(async () => ({ buffer: Buffer.from('secret-file-bytes') }))
  const resolveForPartition = jest.fn(async () => ({ read }))
  const rbacService = {
    loadAcl: jest.fn(async () => ({ isSuperAdmin: false, organizations: [scope.organizationId] })),
    getEffectiveFeatures: jest.fn(async () => ['agent_orchestrator.agents.run', 'attachments.*', 'documents.view']),
  }
  const authPrincipalService = {
    principalExists: jest.fn(), resolveLabels: jest.fn(), listSuperAdminUserIds: jest.fn(), filterActiveRoleIds: jest.fn(),
    resolveActiveUserRoleIds: jest.fn(async () => []),
  }
  const container = createContainer()
  container.register({ em: asValue(em), rbacService: asValue(rbacService), authPrincipalService: asValue(authPrincipalService) })
  registerAttachments(container)
  container.register({ storageDriverFactory: asValue({ resolveForPartition }) })
  const calls: { id: string; input: unknown }[] = []
  const commandBus = { execute: jest.fn(async (id: string, opts: { input: unknown }) => {
    calls.push({ id, input: opts.input })
    return { result: { runId: 'run-access' } }
  }) }
  const store = new InMemoryAgentRunSessionStore()
  const dispose = jest.spyOn(store, 'dispose')
  const release = jest.fn(async () => undefined)
  container.register({
    agentRunSessionStore: asValue(store),
    agentWorkspaceManager: asValue({ acquire: async () => ({ inDir: '/sandbox/in', outDir: '/sandbox/out', release }) }),
  })
  const client = {
    createSession: jest.fn(async () => ({ id: 'session-access' })),
    sendMessage: jest.fn(async () => {
      await store.completeOutcome('sess_attachment_access', { kind: 'research', data: {} })
      return {}
    }),
    subscribeToEvents: () => () => undefined,
  } satisfies OpenCodeRunnerClient
  const runner = new OpenCodeAgentRunner({ container, commandBus: commandBus as never, openCodeClient: client })
  return { container, em, read, resolveForPartition, rbacService, runner, client, calls, release, dispose }
}

beforeEach(() => {
  jest.clearAllMocks()
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: attachmentAccessResolvers, protectedTargets: protectedAttachmentTargets }])
})

afterEach(() => { registerAttachmentAccessResolvers([]) })

describe('attachment staging owner policy through the real service and Documents resolver', () => {
  const previousFiles = process.env.OM_OPENCODE_FILES_ENABLED
  beforeAll(() => { process.env.OM_OPENCODE_FILES_ENABLED = 'true' })
  afterAll(() => {
    if (previousFiles === undefined) delete process.env.OM_OPENCODE_FILES_ENABLED
    else process.env.OM_OPENCODE_FILES_ENABLED = previousFiles
  })

  it.each([
    ['unshared primary owner', {}, userId, false],
    ['unshared assignment owner', { assignment: true }, userId, false],
    ['missing required provider', {}, userId, true],
    ['foreign tenant', { attachmentScope: { ...scope, tenantId: 'foreign-tenant' } }, userId, false],
    ['foreign organization', { attachmentScope: { ...scope, organizationId: 'foreign-org' } }, userId, false],
    ['absent actor', {}, '', false],
  ] as const)('denies %s before storage, workspace bytes or model dispatch, with safe failure and cleanup', async (_name, options, actorId, missingProvider) => {
    if (missingProvider) registerAttachmentAccessResolvers([])
    const test = harness(options)
    const readScoped = jest.spyOn(test.container.resolve<AttachmentService>('attachmentService'), 'readScoped')
    const error = await test.runner.run(entry, { __files: files }, { ...scope, userId: actorId }).catch((caught: unknown) => caught)
    expect({
      storageResolutions: test.resolveForPartition.mock.calls.length,
      storageReads: test.read.mock.calls.length,
      workspaceWrites: jest.mocked(writeFile).mock.calls.length,
      modelMessages: test.client.sendMessage.mock.calls.length,
    }).toEqual({ storageResolutions: 0, storageReads: 0, workspaceWrites: 0, modelMessages: 0 })
    expect(error).toMatchObject({ message: expect.stringContaining('attachment staging failed: attachment input unavailable') })
    if (actorId && !('attachmentScope' in options)) expect(readScoped).toHaveBeenCalledTimes(1)
    if (_name.startsWith('unshared')) {
      expect(test.rbacService.getEffectiveFeatures).toHaveBeenCalledWith(userId, scope)
      expect(test.em.findOne.mock.calls).toContainEqual([Document, expect.objectContaining({ id: documentId, ...scope, deletedAt: null }), undefined, scope])
      expect(test.em.find.mock.calls).toContainEqual([DocumentShare, expect.objectContaining({ documentId, ...scope }), undefined, scope])
    }
    expect(test.calls).toContainEqual({ id: 'agent_orchestrator.runs.fail', input: { runId: 'run-access', errorMessage: 'attachment staging failed: attachment input unavailable' } })
    expect(JSON.stringify([error, test.calls])).not.toMatch(/secret-|private\.txt|documents:document/)
    expect(test.release).toHaveBeenCalledTimes(1)
    expect(test.dispose).toHaveBeenCalledWith('sess_attachment_access')
    expect(deleteSessionApiKey).toHaveBeenCalledWith(test.em, 'sess_attachment_access')
  })

  it('passes the invoking actor through the runner and dispatches only after an authorized file is staged', async () => {
    const test = harness({ ownerUserId: userId })
    await expect(test.runner.run(entry, { __files: files }, { ...scope, userId })).resolves.toEqual({ kind: 'research', data: {} })
    expect(test.read).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledTimes(2)
    expect(test.client.sendMessage).toHaveBeenCalledTimes(1)
    expect(jest.mocked(writeFile).mock.invocationCallOrder[1]).toBeLessThan(test.client.sendMessage.mock.invocationCallOrder[0])
    expect(test.calls.some((call) => call.id === 'agent_orchestrator.runs.fail')).toBe(false)
    expect(test.release).toHaveBeenCalledTimes(1)
  })

  it.each([{ ownerUserId: userId }, { shared: true }])('stages allowed owners/shares with cached OCR only after live policy: %j', async (options) => {
    const test = harness(options)
    const readScoped = jest.spyOn(test.container.resolve<AttachmentService>('attachmentService'), 'readScoped')
    await expect(stageAttachments({ container: test.container, em: test.em as unknown as EntityManager, files,
      inDir: '/sandbox/in', ...scope, userId })).resolves.toEqual([{ fileName: 'private.txt', hasSidecar: true }])
    expect(readScoped).toHaveBeenCalledWith({ attachmentId, auth: { sub: userId, tenantId: scope.tenantId, orgId: scope.organizationId },
      expectedOwner: { entityId: 'documents:document', recordId: documentId } })
    expect(test.rbacService.getEffectiveFeatures).toHaveBeenCalledWith(userId, scope)
    expect(test.read).toHaveBeenCalledWith('privateAttachments', 'secret-storage-path')
    expect(writeFile).toHaveBeenNthCalledWith(1, path.join('/sandbox/in', 'private.txt'), Buffer.from('secret-file-bytes'))
    expect(writeFile).toHaveBeenNthCalledWith(2, `${path.join('/sandbox/in', 'private.txt')}.txt`, 'secret-ocr-content', 'utf8')
  })

  it('fails closed without service wiring and never falls back to the raw driver', async () => {
    const test = harness({ ownerUserId: userId })
    test.container.register({ attachmentService: asValue(undefined) })
    await expect(test.runner.run(entry, { __files: files }, { ...scope, userId })).rejects.toThrow('attachment staging failed: attachment input unavailable')
    expect(test.resolveForPartition).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(test.client.sendMessage).not.toHaveBeenCalled()
  })

  it('preserves the identical branded storage error after authorization and persists only its safe code and reason', async () => {
    const test = harness({ ownerUserId: userId })
    const storageError = new AttachmentStorageConfigurationError('invalid_config')
    storageError.message = 'secret-storage-credentials'
    test.read.mockRejectedValue(storageError)
    const error = await test.runner.run(entry, { __files: files }, { ...scope, userId }).catch((caught: unknown) => caught)
    expect(error).toBe(storageError)
    expect(test.calls).toContainEqual({ id: 'agent_orchestrator.runs.fail', input: {
      runId: 'run-access', errorMessage: 'ATTACHMENT_STORAGE_CONFIGURATION_INVALID: invalid_config',
    } })
    expect(JSON.stringify(test.calls)).not.toContain('secret-storage-credentials')
    expect(writeFile).not.toHaveBeenCalled()
    expect(test.client.sendMessage).not.toHaveBeenCalled()
    expect(test.release).toHaveBeenCalledTimes(1)
    expect(test.dispose).toHaveBeenCalledWith('sess_attachment_access')
    expect(deleteSessionApiKey).toHaveBeenCalledWith(test.em, 'sess_attachment_access')
  })

  it('redacts unexpected service error messages from persisted failure and thrown error', async () => {
    const test = harness()
    const stagingError = new Error('secret-policy-credentials')
    const reportError = jest.fn()
    const logRecord = jest.fn()
    const unregisterLogger = registerLoggerExtension({ emit: logRecord })
    const unregisterTelemetry = registerTelemetryRuntime({
      canUseGlobalTracePropagation: () => false,
      captureTraceContext: () => ({}),
      continueTrace: (_carrier, _spanName, callback) => callback(),
      recordHttpDuration: () => undefined,
      reportError,
      shutdown: async () => undefined,
    })
    try {
      test.container.register({ attachmentService: asValue({ readScoped: async () => { throw stagingError } }) })
      const error = await test.runner.run(entry, { __files: files }, { ...scope, userId }).catch((caught: unknown) => caught)
      expect(error).toMatchObject({ message: expect.stringContaining('attachment staging failed: attachment input unavailable') })
      expect(JSON.stringify([error, test.calls])).not.toContain('secret-policy-credentials')
      expect(reportError).toHaveBeenCalledTimes(1)
      expect(reportError).toHaveBeenCalledWith(stagingError, {
        module: 'agent_orchestrator', code: 'agent_orchestrator.attachment_staging_failed',
        attributes: { agentId: entry.id, runId: 'run-access' },
      })
      expect(logRecord).toHaveBeenCalledWith(expect.objectContaining({
        namespace: 'agent_orchestrator', level: 'warn', message: 'attachment staging failed',
        fields: expect.objectContaining({ agentId: entry.id, runId: 'run-access', error: stagingError.message }),
      }))
      expect(test.resolveForPartition).not.toHaveBeenCalled()
      expect(writeFile).not.toHaveBeenCalled()
      expect(test.client.sendMessage).not.toHaveBeenCalled()
    } finally {
      unregisterTelemetry()
      unregisterLogger()
    }
  })
})
