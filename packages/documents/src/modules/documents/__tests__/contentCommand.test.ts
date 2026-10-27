import type { EntityManager } from '@mikro-orm/postgresql'
import { CommandBus, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { DocumentContent } from '../data/entities'

const mockLockDocumentAggregateRoot = jest.fn()
const mockLoadLockedDocumentContent = jest.fn()
const mockAssertDocumentCommandCanEdit = jest.fn()
const mockMaterializeReplacement = jest.fn()

jest.mock('../commands/aggregate', () => ({
  lockDocumentAggregateRoot: (...args: unknown[]) => mockLockDocumentAggregateRoot(...args),
  loadLockedDocumentContent: (...args: unknown[]) => mockLoadLockedDocumentContent(...args),
}))

jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return {
    ...actual,
    assertDocumentCommandCanEdit: (...args: unknown[]) => mockAssertDocumentCommandCanEdit(...args),
  }
})

jest.mock('../lib/collabMaterializer', () => ({
  materializeDocumentContentReplacement: (...args: unknown[]) => mockMaterializeReplacement(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

import {
  replaceDocumentContentCommand,
  type ReplaceDocumentContentCommandInput,
} from '../commands/content'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'
const CONTENT_ID = '55555555-5555-4555-8555-555555555555'
const INITIAL_UPDATED_AT = '2026-07-10T10:00:00.000Z'

type FakeEntityManager = EntityManager & {
  begin: jest.Mock
  commit: jest.Mock
  rollback: jest.Mock
  flush: jest.Mock
  nativeUpdate: jest.Mock
  refresh: jest.Mock
  persist: jest.Mock
}

function contentRow(): DocumentContent {
  return Object.assign(new DocumentContent(), {
    id: CONTENT_ID,
    documentId: DOCUMENT_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    yjsState: Buffer.from([1, 2, 3]),
    contentHtml: '<p>Before</p>',
    contentText: 'Before',
    createdAt: new Date('2026-07-10T09:00:00.000Z'),
    updatedAt: new Date(INITIAL_UPDATED_AT),
    deletedAt: null,
  })
}

function input(overrides: Partial<ReplaceDocumentContentCommandInput> = {}): ReplaceDocumentContentCommandInput {
  return {
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    documentId: DOCUMENT_ID,
    contentId: CONTENT_ID,
    contentHtml: '<p>Requested</p>',
    contentText: 'untrusted text',
    ...overrides,
  }
}

function makeEntityManager(
  getContent: () => DocumentContent | null,
  order: string[],
  options: { failFlush?: boolean } = {},
): FakeEntityManager {
  let flushCount = 0
  const em = {
    fork: jest.fn(() => em),
    begin: jest.fn(async () => { order.push('begin') }),
    commit: jest.fn(async () => { order.push('commit') }),
    rollback: jest.fn(async () => { order.push('rollback') }),
    flush: jest.fn(async () => {
      flushCount += 1
      order.push(`flush-${flushCount}`)
      if (options.failFlush && flushCount === 1) throw new Error('flush failed')
    }),
    nativeUpdate: jest.fn(async (_entity, _where, update: { updatedAt: Date }) => {
      order.push('pin-version')
      const content = getContent()
      if (!content) return 0
      content.updatedAt = new Date(update.updatedAt)
      return 1
    }),
    refresh: jest.fn(async () => { order.push('refresh') }),
    create: jest.fn((entity: new () => object, data: Record<string, unknown>) => (
      Object.assign(new entity(), data)
    )),
    persist: jest.fn(),
  } as unknown as FakeEntityManager
  return em
}

function makeContext(
  em: EntityManager,
  expectedUpdatedAt?: string,
  dependencies: Record<string, unknown> = {},
): CommandRuntimeContext {
  const headers = new Headers()
  if (expectedUpdatedAt) {
    headers.set('x-om-ext-optimistic-lock-expected-updated-at', expectedUpdatedAt)
  }
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name]
        throw new Error(`Unexpected dependency: ${name}`)
      },
    } as CommandRuntimeContext['container'],
    auth: {
      sub: USER_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
      features: ['documents.edit'],
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
    request: new Request('http://localhost/api/documents/content', { headers }),
  }
}

describe('documents content replace command', () => {
  let content: DocumentContent
  let order: string[]
  let em: FakeEntityManager

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers({ now: new Date('2026-07-10T10:00:01.000Z') })
    content = contentRow()
    order = []
    em = makeEntityManager(() => content, order)
    mockLockDocumentAggregateRoot.mockImplementation(async () => {
      order.push('lock-document')
      return { id: DOCUMENT_ID }
    })
    mockAssertDocumentCommandCanEdit.mockImplementation(async () => {
      order.push('authorize-document')
      return ['documents.edit']
    })
    mockLoadLockedDocumentContent.mockImplementation(async () => {
      order.push('lock-content')
      return content
    })
    mockMaterializeReplacement.mockImplementation((state: Buffer, html: string) => {
      order.push('canonicalize')
      expect(Buffer.from(state)).toEqual(Buffer.from([1, 2, 3]))
      expect(html).toBe('<p>Requested</p>')
      return {
        yjsState: Buffer.from([9, 8, 7]),
        html: '<p>Canonical</p>',
        text: 'Canonical',
      }
    })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('commits a canonical replacement only after locking and independently authorizing the document', async () => {
    const result = await replaceDocumentContentCommand.execute(input(), makeContext(em))

    expect(result.id).toBe(CONTENT_ID)
    expect(result.updatedAt).toBe('2026-07-10T10:00:01.000Z')
    expect(content.contentHtml).toBe('<p>Canonical</p>')
    expect(content.contentText).toBe('Canonical')
    expect(content.yjsState).toEqual(Buffer.from([9, 8, 7]))
    expect(content.collaborationGeneration).toBe(2)
    expect(result.projections).toEqual([
      {
        kind: 'document-index',
        documentId: DOCUMENT_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
      },
      {
        kind: 'event',
        eventId: 'documents.document.updated',
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        payload: {
          id: DOCUMENT_ID,
          documentId: DOCUMENT_ID,
          tenantId: TENANT_ID,
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
          contentEpochReset: true,
        },
      },
    ])
    expect(order.indexOf('begin')).toBeLessThan(order.indexOf('lock-document'))
    expect(order.indexOf('lock-document')).toBeLessThan(order.indexOf('authorize-document'))
    expect(order.indexOf('authorize-document')).toBeLessThan(order.indexOf('lock-content'))
    expect(order.indexOf('lock-content')).toBeLessThan(order.indexOf('canonicalize'))
    expect(order.indexOf('flush-1')).toBeLessThan(order.indexOf('pin-version'))
    expect(order.at(-1)).toBe('commit')
    expect(mockLoadLockedDocumentContent).toHaveBeenCalledWith(
      em,
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      { includeDeleted: true },
    )
  })

  it('allocates a strictly newer content token when the clock moves backwards', async () => {
    jest.setSystemTime(new Date('2020-01-01T00:00:00.000Z'))

    const result = await replaceDocumentContentCommand.execute(input(), makeContext(em))

    expect(result.updatedAt).toBe('2026-07-10T10:00:00.001Z')
    expect(Date.parse(result.updatedAt)).toBeGreaterThan(Date.parse(INITIAL_UPDATED_AT))
  })

  it('keeps legacy no-header writes additive while rejecting a stale supplied version', async () => {
    await expect(replaceDocumentContentCommand.execute(input(), makeContext(em))).resolves.toBeDefined()

    content = contentRow()
    order = []
    em = makeEntityManager(() => content, order)
    await expect(replaceDocumentContentCommand.execute(
      input(),
      makeContext(em, '2026-07-10T09:59:59.000Z'),
    )).rejects.toMatchObject({
      status: 409,
      body: { code: 'optimistic_lock_conflict' },
    })
    expect(mockMaterializeReplacement).toHaveBeenCalledTimes(1)
    expect(em.rollback).toHaveBeenCalledTimes(1)
  })

  it('rolls back when the canonical content write cannot flush', async () => {
    em = makeEntityManager(() => content, order, { failFlush: true })

    await expect(replaceDocumentContentCommand.execute(input(), makeContext(em)))
      .rejects.toThrow('flush failed')

    expect(em.commit).not.toHaveBeenCalled()
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('persists a bounded metadata-only audit row and does not advertise undo or redo', async () => {
    const beforeMarker = 'BEFORE_PRIVATE_BODY_'.repeat(4_096)
    const afterMarker = 'AFTER_PRIVATE_BODY_'.repeat(4_096)
    content.contentHtml = `<p>${beforeMarker}</p>`
    content.contentText = beforeMarker
    content.yjsState = Buffer.alloc(256 * 1_024, 7)
    mockMaterializeReplacement.mockImplementationOnce(() => ({
      yjsState: Buffer.alloc(256 * 1_024, 9),
      html: `<p>${afterMarker}</p>`,
      text: afterMarker,
    }))
    const log = jest.fn(async (entry: Record<string, unknown>) => ({
      id: '66666666-6666-4666-8666-666666666666',
      ...entry,
    }))
    const dataEngine = { flushOrmEntityChanges: jest.fn(async () => undefined) }
    const commandInput = input()
    const ctx = makeContext(em, undefined, {
      actionLogService: { log },
      dataEngine,
    })
    const execution = await new CommandBus().execute('documents.content.replace', {
      input: commandInput,
      ctx,
    })

    expect(replaceDocumentContentCommand.isUndoable).toBe(false)
    expect(replaceDocumentContentCommand.undo).toBeUndefined()
    expect(execution.logEntry).not.toHaveProperty('undoToken')
    expect(log).toHaveBeenCalledTimes(1)
    const persisted = log.mock.calls[0]?.[0]
    expect(persisted).toMatchObject({
      snapshotBefore: {
        id: CONTENT_ID,
        contentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      },
      snapshotAfter: {
        id: CONTENT_ID,
        contentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      },
      commandPayload: {
        __redoInput: null,
        documentId: DOCUMENT_ID,
        contentId: CONTENT_ID,
        beforeContentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        afterContentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        contentUpdatedAt: '2026-07-10T10:00:01.000Z',
      },
    })
    expect(persisted).not.toHaveProperty('undoToken')
    expect((persisted as { commandPayload: Record<string, unknown> }).commandPayload)
      .not.toHaveProperty('undo')
    const serialized = JSON.stringify(persisted)
    expect(serialized.length).toBeLessThan(4_096)
    expect(serialized).not.toMatch(/yjsState|contentHtml|contentText|"undo"/)
    expect(serialized).not.toContain('BEFORE_PRIVATE_BODY_')
    expect(serialized).not.toContain('AFTER_PRIVATE_BODY_')
  })

  it('persists the first legacy body write as a live row without creating an undo snapshot', async () => {
    let createdContent: DocumentContent | null = null
    order = []
    em = makeEntityManager(() => createdContent, order)
    em.create.mockImplementation((entity: new () => object, data: Record<string, unknown>) => {
      createdContent = Object.assign(new entity(), data) as DocumentContent
      return createdContent
    })
    mockLoadLockedDocumentContent.mockImplementation(async () => {
      order.push('lock-content')
      return createdContent
    })
    mockMaterializeReplacement.mockImplementation(() => ({
      yjsState: Buffer.from([9, 8, 7]),
      html: '<p>Canonical</p>',
      text: 'Canonical',
    }))

    const commandInput = input()
    const ctx = makeContext(em)
    const result = await replaceDocumentContentCommand.execute(commandInput, ctx)
    const metadata = await replaceDocumentContentCommand.buildLog?.({
      input: commandInput,
      result,
      ctx,
      snapshots: {},
    })

    expect(createdContent).toMatchObject({
      id: CONTENT_ID,
      contentHtml: '<p>Canonical</p>',
      contentText: 'Canonical',
      yjsState: Buffer.from([9, 8, 7]),
      deletedAt: null,
      collaborationGeneration: 1,
    })
    expect(result.before).toBeNull()
    expect(metadata).toMatchObject({
      snapshotBefore: null,
      snapshotAfter: {
        id: CONTENT_ID,
        contentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      },
      payload: {
        __redoInput: null,
      },
    })
  })
})
