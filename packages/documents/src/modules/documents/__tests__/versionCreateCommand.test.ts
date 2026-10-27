import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Document, DocumentContent, DocumentVersion } from '../data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockAssertDocumentCommandCanEdit = jest.fn(async () => ['documents.edit'])
const mockEnforceDocumentVersionRetention = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback: string) => fallback,
  }),
}))

jest.mock('../lib/historyLimits', () => ({
  ...jest.requireActual('../lib/historyLimits'),
  enforceDocumentVersionRetention: (...args: unknown[]) => mockEnforceDocumentVersionRetention(...args),
}))

jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return {
    ...actual,
    assertDocumentCommandCanEdit: (...args: unknown[]) => mockAssertDocumentCommandCanEdit(...args),
  }
})

import {
  createVersionCommand,
  type CreateVersionCommandInput,
} from '../commands/versions'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const actorUserId = '33333333-3333-4333-8333-333333333333'
const documentId = '44444444-4444-4444-8444-444444444444'
const contentId = '55555555-5555-4555-8555-555555555555'
const versionId = '66666666-6666-4666-8666-666666666666'
const createdAt = '2026-07-10T12:00:00.000Z'

function makeDocument(): Document {
  return Object.assign(new Document(), {
    id: documentId,
    tenantId,
    organizationId,
    title: 'Quarterly review',
    ownerUserId: actorUserId,
    createdByUserId: actorUserId,
    updatedAt: new Date(createdAt),
    deletedAt: null,
  })
}

function makeContent(): DocumentContent {
  return Object.assign(new DocumentContent(), {
    id: contentId,
    documentId,
    tenantId,
    organizationId,
    yjsState: Buffer.from('snapshot'),
    contentHtml: '<p>Snapshot</p>',
    contentText: 'Snapshot',
    updatedAt: new Date(createdAt),
    deletedAt: null,
  })
}

function buildHarness() {
  const order: string[] = []
  mockEnforceDocumentVersionRetention.mockImplementation(async () => { order.push('enforce-retention') })
  let persistedVersion: DocumentVersion | null = null
  let existingVersion: DocumentVersion | null = null
  const dataEngine = {
    markOrmEntityChange: jest.fn(() => order.push('buffer-event')),
  }
  const em = {
    fork: jest.fn(() => em),
    begin: jest.fn(async () => { order.push('begin') }),
    flush: jest.fn(async () => { order.push('flush') }),
    commit: jest.fn(async () => { order.push('commit') }),
    rollback: jest.fn(async () => { order.push('rollback') }),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      if (entity !== DocumentVersion) throw new Error('Unexpected entity')
      return Object.assign(new DocumentVersion(), data)
    }),
    persist: jest.fn((version: DocumentVersion) => {
      persistedVersion = version
      existingVersion = version
    }),
    remove: jest.fn((version: DocumentVersion) => {
      order.push('remove-version')
      if (existingVersion?.id === version.id) existingVersion = null
    }),
  } as unknown as EntityManager
  const ctx: CommandRuntimeContext = {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as CommandRuntimeContext['container'],
    auth: {
      sub: actorUserId,
      userId: actorUserId,
      tenantId,
      orgId: organizationId,
      features: ['documents.edit'],
    } as CommandRuntimeContext['auth'],
    selectedOrganizationId: organizationId,
    organizationScope: null,
    organizationIds: [organizationId],
  }
  mockFindOneWithDecryption.mockImplementation(async (
    _em: EntityManager,
    entity: unknown,
  ) => {
    if (entity === Document) {
      order.push('lock-document')
      return makeDocument()
    }
    if (entity === DocumentVersion) {
      order.push('lock-version')
      return existingVersion
    }
    if (entity === DocumentContent) {
      order.push('lock-content')
      return makeContent()
    }
    throw new Error('Unexpected entity read')
  })
  mockAssertDocumentCommandCanEdit.mockImplementation(async () => {
    order.push('authorize')
    return ['documents.edit']
  })
  return {
    ctx,
    em,
    order,
    dataEngine,
    getVersion: () => existingVersion,
    getPersistedVersion: () => persistedVersion,
  }
}

function input(overrides: Partial<CreateVersionCommandInput> = {}): CreateVersionCommandInput {
  return {
    tenantId,
    organizationId,
    documentId,
    versionId,
    label: 'Before review',
    ...overrides,
  }
}

describe('documents.version.create command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('locks the parent before snapshot reads and buffers the event only after commit', async () => {
    const harness = buildHarness()
    const result = await createVersionCommand.execute(input(), harness.ctx)

    expect(result).toMatchObject({ id: versionId, createdAt: expect.any(String), label: 'Before review' })
    expect(harness.getPersistedVersion()?.yjsSnapshot).toEqual(Buffer.from('snapshot'))
    expect(harness.order).toEqual([
      'begin',
      'lock-document',
      'authorize',
      'lock-version',
      'lock-content',
      'enforce-retention',
      'flush',
      'commit',
      'buffer-event',
    ])
    expect(harness.dataEngine.markOrmEntityChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'created',
      identifiers: { id: versionId, tenantId, organizationId },
    }))
    expect(mockEnforceDocumentVersionRetention).toHaveBeenCalledWith(
      harness.em,
      expect.objectContaining({ tenantId, organizationId, documentId }),
      expect.objectContaining({ yjsSnapshot: Buffer.from('snapshot'), contentHtml: '<p>Snapshot</p>' }),
      [versionId],
    )
  })

  it('is non-undoable and persists metadata-only audit snapshots', async () => {
    const harness = buildHarness()
    const first = await createVersionCommand.execute(input(), harness.ctx)
    const log = await createVersionCommand.buildLog!({
      input: input(),
      result: first,
      ctx: harness.ctx,
      snapshots: {},
    })

    expect(createVersionCommand.isUndoable).toBe(false)
    expect(createVersionCommand.undo).toBeUndefined()
    expect(log).toMatchObject({
      snapshotBefore: null,
      snapshotAfter: {
        id: versionId,
        contentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      },
      payload: {
        versionId,
        documentId,
        contentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        createdAt: expect.any(String),
      },
    })
    expect((log as { payload?: Record<string, unknown> }).payload).not.toHaveProperty('undo')
    const serialized = JSON.stringify(log)
    expect(serialized).not.toMatch(/yjsState|yjsSnapshot|contentHtml|contentText|"undo"/)
    expect(serialized).not.toContain('<p>Snapshot</p>')
    expect(serialized).not.toContain(Buffer.from('snapshot').toString('base64'))
  })
})
