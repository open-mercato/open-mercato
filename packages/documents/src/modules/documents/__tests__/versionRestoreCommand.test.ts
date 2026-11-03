import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Document, DocumentContent, DocumentVersion } from '../data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockAssertDocumentCommandCanEdit = jest.fn()
const mockMutateDocumentContentState = jest.fn()
const mockEnforceDocumentVersionRetention = jest.fn(async () => [])

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback: string) => fallback,
  }),
}))

jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return {
    ...actual,
    assertDocumentCommandCanEdit: (...args: unknown[]) => mockAssertDocumentCommandCanEdit(...args),
  }
})

jest.mock('../lib/contentService', () => ({
  advanceDocumentCollaborationGeneration: (content: { collaborationGeneration?: number }) => {
    content.collaborationGeneration = (content.collaborationGeneration ?? 1) + 1
    return content.collaborationGeneration
  },
  mutateDocumentContentState: (...args: unknown[]) => mockMutateDocumentContentState(...args),
}))

jest.mock('../lib/historyLimits', () => ({
  ...jest.requireActual('../lib/historyLimits'),
  enforceDocumentVersionRetention: (...args: unknown[]) => mockEnforceDocumentVersionRetention(...args),
}))

jest.mock('../lib/versionContent', () => ({
  materializeDocumentVersion: (version: { contentHtml?: string | null }) => ({
    yjsState: Buffer.from('materialized target'),
    contentHtml: version.contentHtml ?? '',
    contentText: 'After body',
  }),
}))

import {
  restoreVersionCommand,
  type RestoreVersionCommandInput,
} from '../commands/versions'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const actorUserId = '33333333-3333-4333-8333-333333333333'
const documentId = '44444444-4444-4444-8444-444444444444'
const contentId = '55555555-5555-4555-8555-555555555555'
const versionId = '66666666-6666-4666-8666-666666666666'
const preRestoreVersionId = '77777777-7777-4777-8777-777777777777'
const beforeUpdatedAt = '2026-07-10T12:00:00.000Z'
const afterUpdatedAt = '2026-07-10T12:00:01.000Z'

function input(): RestoreVersionCommandInput {
  return {
    tenantId,
    organizationId,
    documentId,
    versionId,
    preRestoreVersionId,
    actorUserId,
    expectedContentUpdatedAt: beforeUpdatedAt,
    restoreContentUpdatedAt: afterUpdatedAt,
  }
}

describe('documents.version.restore command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('stores the reversible checkpoint only in bounded history and logs metadata only', async () => {
    const order: string[] = []
    const content = Object.assign(new DocumentContent(), {
      id: contentId,
      tenantId,
      organizationId,
      documentId,
      yjsState: Buffer.alloc(0),
      contentHtml: '<p>Before body</p>',
      contentText: 'Before body',
      collaborationGeneration: 1,
      createdAt: new Date(beforeUpdatedAt),
      updatedAt: new Date(beforeUpdatedAt),
      deletedAt: null,
    })
    const targetVersion = Object.assign(new DocumentVersion(), {
      id: versionId,
      tenantId,
      organizationId,
      documentId,
      label: 'Target version',
      yjsSnapshot: Buffer.alloc(0),
      contentHtml: '<p>After body</p>',
      createdByUserId: actorUserId,
      createdAt: new Date('2026-07-10T11:00:00.000Z'),
    })
    let checkpoint: DocumentVersion | null = null
    const dataEngine = {
      markOrmEntityChange: jest.fn(() => { order.push('buffer-index') }),
    }
    const em = {
      fork: jest.fn(() => em),
      begin: jest.fn(async () => { order.push('begin') }),
      flush: jest.fn(async () => { order.push('flush') }),
      commit: jest.fn(async () => { order.push('commit') }),
      rollback: jest.fn(async () => { order.push('rollback') }),
      create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
        if (entity !== DocumentVersion) throw new Error('Unexpected entity')
        checkpoint = Object.assign(new DocumentVersion(), data, {
          createdAt: new Date('2026-07-10T12:00:00.500Z'),
        })
        return checkpoint
      }),
      persist: jest.fn((version: DocumentVersion) => {
        order.push('persist-checkpoint')
        checkpoint = version
      }),
      nativeUpdate: jest.fn(async (_entity, _where, data: { updatedAt: Date }) => {
        order.push('pin-content-token')
        content.updatedAt = data.updatedAt
        return 1
      }),
      refresh: jest.fn(async () => undefined),
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
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
    }

    mockFindOneWithDecryption.mockImplementation(async (
      _em: EntityManager,
      entity: unknown,
      where: { id?: string },
    ) => {
      if (entity === Document) {
        order.push('lock-document')
        return Object.assign(new Document(), {
          id: documentId,
          tenantId,
          organizationId,
          ownerUserId: actorUserId,
          createdByUserId: actorUserId,
          updatedAt: new Date(beforeUpdatedAt),
          deletedAt: null,
        })
      }
      if (entity === DocumentContent) {
        order.push('lock-content')
        return content
      }
      if (entity === DocumentVersion && where.id === versionId) {
        order.push('load-target-version')
        return targetVersion
      }
      if (entity === DocumentVersion && where.id === preRestoreVersionId) {
        order.push('check-checkpoint-id')
        return null
      }
      throw new Error('Unexpected entity read')
    })
    mockAssertDocumentCommandCanEdit.mockImplementation(async () => {
      order.push('authorize')
      return ['documents.edit']
    })
    mockEnforceDocumentVersionRetention.mockImplementation(async () => {
      order.push('enforce-retention')
      return []
    })
    mockMutateDocumentContentState.mockImplementation(async (
      _em: EntityManager,
      _documentId: string,
      _scope: unknown,
      state: { yjsState: Buffer; contentHtml: string; contentText: string },
    ) => {
      order.push('mutate-content')
      content.yjsState = state.yjsState
      content.contentHtml = state.contentHtml
      content.contentText = state.contentText
      return content
    })

    const result = await restoreVersionCommand.execute(input(), ctx)
    const log = await restoreVersionCommand.buildLog!({
      input: input(),
      result,
      ctx,
      snapshots: {},
    })

    expect(restoreVersionCommand.isUndoable).toBe(false)
    expect(restoreVersionCommand.undo).toBeUndefined()
    expect(order.indexOf('lock-document')).toBeLessThan(order.indexOf('authorize'))
    expect(order.indexOf('authorize')).toBeLessThan(order.indexOf('lock-content'))
    expect(order.indexOf('enforce-retention')).toBeLessThan(order.indexOf('mutate-content'))
    expect(order.indexOf('commit')).toBeLessThan(order.indexOf('buffer-index'))
    expect(content.contentHtml).toBe('<p>After body</p>')
    expect(content.contentText).toBe('After body')
    expect(content.collaborationGeneration).toBe(2)
    expect(content.updatedAt.toISOString()).toBe(afterUpdatedAt)
    expect(checkpoint).toMatchObject({
      id: preRestoreVersionId,
      documentId,
      contentHtml: '<p>Before body</p>',
      createdByUserId: actorUserId,
    })
    expect(mockEnforceDocumentVersionRetention).toHaveBeenCalledWith(
      em,
      expect.objectContaining({ tenantId, organizationId, documentId }),
      expect.objectContaining({ yjsSnapshot: Buffer.alloc(0), contentHtml: '<p>Before body</p>' }),
      [versionId, preRestoreVersionId],
    )
    expect(log).toMatchObject({
      resourceId: versionId,
      relatedResourceId: preRestoreVersionId,
      snapshotBefore: {
        id: preRestoreVersionId,
        contentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      },
      snapshotAfter: {
        id: versionId,
        contentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        contentUpdatedAt: afterUpdatedAt,
      },
      payload: {
        restoredVersionId: versionId,
        preRestoreVersionId,
        restoredContentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        preRestoreContentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      },
    })
    expect((log as { payload?: Record<string, unknown> }).payload).not.toHaveProperty('undo')
    const serialized = JSON.stringify(log)
    expect(serialized).not.toMatch(/yjsState|yjsSnapshot|contentHtml|contentText|"undo"/)
    expect(serialized).not.toContain('<p>Before body</p>')
    expect(serialized).not.toContain('<p>After body</p>')
    expect(serialized).not.toContain(Buffer.from('<p>Before body</p>').toString('base64'))
  })
})
