import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  Document,
  DocumentFinding,
  DocumentReviewPlaybook,
  DocumentReviewPlaybookReference,
  DocumentReviewRule,
} from '../data/entities'

type Row = Record<string, unknown>

const mockStore = {
  playbooks: [] as DocumentReviewPlaybook[],
  rules: [] as DocumentReviewRule[],
  references: [] as DocumentReviewPlaybookReference[],
  findings: [] as DocumentFinding[],
  document: null as Document | null,
}
const mockFeatures = jest.fn(async () => ['documents.review_playbooks.manage'])
const mockAssertCapability = jest.fn(async () => [])

function mockRowsFor(entity: unknown): Row[] {
  if (entity === DocumentReviewPlaybook) return mockStore.playbooks as unknown as Row[]
  if (entity === DocumentReviewRule) return mockStore.rules as unknown as Row[]
  if (entity === DocumentReviewPlaybookReference) return mockStore.references as unknown as Row[]
  if (entity === Document) return mockStore.document ? [mockStore.document as unknown as Row] : []
  return mockStore.findings as unknown as Row[]
}

function mockMatches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key]
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('$in' in expected) return (expected as { $in: unknown[] }).$in.includes(actual)
      if ('$ne' in expected) {
        const excluded = (expected as { $ne: unknown }).$ne
        if (excluded === null) return actual !== null && actual !== undefined
        return actual !== excluded
      }
    }
    if (expected === null) return actual === null || actual === undefined
    return actual === expected
  })
}

function mockQuery(entity: unknown, where: Row): Row[] {
  return mockRowsFor(entity).filter((row) => mockMatches(row, where))
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (_em: unknown, entity: unknown, where: Row) => mockQuery(entity, where)),
  findOneWithDecryption: jest.fn(async (_em: unknown, entity: unknown, where: Row) => mockQuery(entity, where)[0] ?? null),
}))

jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return {
    ...actual,
    resolveDocumentsCommandFeatures: (...args: unknown[]) => mockFeatures(...(args as [])),
    assertDocumentCommandCapability: (...args: unknown[]) => mockAssertCapability(...(args as [])),
  }
})

jest.mock('../lib/contentService', () => ({
  loadDocumentContent: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

import {
  createReviewPlaybookCommand,
  createReviewPlaybookReferenceCommand,
  createReviewRuleCommand,
  deleteReviewRuleCommand,
  updateReviewPlaybookCommand,
  updateReviewRuleCommand,
  type ReviewRuleCommandResult,
} from '../commands/reviewPlaybooks'
import { ingestFindingsCommand } from '../commands/findings'
import { DOCUMENTS_MAX_ACTIVE_RULES_PER_PLAYBOOK, DOCUMENTS_MAX_REFERENCES_PER_PLAYBOOK } from '../lib/resourceLimits'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'
const PLAYBOOK_ID = '55555555-5555-4555-8555-555555555555'
const OTHER_PLAYBOOK_ID = '66666666-6666-4666-8666-666666666666'
const SCOPE = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }

let idSequence = 0
function nextId(): string {
  idSequence += 1
  return `77777777-7777-4777-8777-${String(idSequence).padStart(12, '0')}`
}

function persistTarget(entity: object): unknown[] {
  if (entity instanceof DocumentReviewPlaybook) return mockStore.playbooks
  if (entity instanceof DocumentReviewRule) return mockStore.rules
  if (entity instanceof DocumentReviewPlaybookReference) return mockStore.references
  return mockStore.findings
}

function makeEntityManager(): EntityManager {
  const em = {
    fork: jest.fn(() => em),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    isInTransaction: jest.fn(() => false),
    create: jest.fn((entity: new () => object, data: Row) => Object.assign(new entity(), data, {
      updatedAt: new Date('2026-11-12T10:00:00.000Z'),
    })),
    persist: jest.fn((entity: object) => {
      persistTarget(entity).push(entity)
    }),
    count: jest.fn(async (entity: unknown, where: Row) => mockQuery(entity, where).length),
    nativeUpdate: jest.fn(async (entity: unknown, where: Row, data: Row) => {
      const rows = mockQuery(entity, where)
      for (const row of rows) Object.assign(row, data)
      return rows.length
    }),
  }
  return em as unknown as EntityManager
}

function makeContext(em: EntityManager): CommandRuntimeContext {
  const dataEngine = { markOrmEntityChange: jest.fn() }
  return {
    container: {
      resolve: (name: string) => (name === 'em' ? em : name === 'dataEngine' ? dataEngine : null),
    } as CommandRuntimeContext['container'],
    auth: { sub: USER_ID, userId: USER_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
  }
}

function seedPlaybook(id: string, code: string, overrides: Partial<DocumentReviewPlaybook> = {}): DocumentReviewPlaybook {
  const playbook = Object.assign(new DocumentReviewPlaybook(), {
    id,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    code,
    name: `Playbook ${code}`,
    version: 1,
    isActive: true,
    deletedAt: null,
    updatedAt: new Date('2026-11-12T09:00:00.000Z'),
    ...overrides,
  })
  mockStore.playbooks.push(playbook)
  return playbook
}

function seedRule(playbookId: string, code: string, overrides: Partial<DocumentReviewRule> = {}): DocumentReviewRule {
  const rule = Object.assign(new DocumentReviewRule(), {
    id: nextId(),
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    playbookId,
    code,
    title: `Rule ${code}`,
    position: 'Standard position.',
    severity: 'warning',
    sortOrder: 0,
    isActive: true,
    deletedAt: null,
    updatedAt: new Date('2026-11-12T09:00:00.000Z'),
    ...overrides,
  })
  mockStore.rules.push(rule)
  return rule
}

async function expectHttpError(promise: Promise<unknown>, status: number, code?: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    status,
    ...(code ? { body: expect.objectContaining({ code }) } : {}),
  })
}

beforeEach(() => {
  mockStore.playbooks = []
  mockStore.rules = []
  mockStore.references = []
  mockStore.findings = []
  mockStore.document = Object.assign(new Document(), {
    id: DOCUMENT_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    deletedAt: null,
  })
  mockFeatures.mockClear()
  mockAssertCapability.mockClear()
})

describe('review playbook commands', () => {
  it('creates a playbook at version 1 and bumps the version on update', async () => {
    const em = makeEntityManager()
    const ctx = makeContext(em)
    const created = await createReviewPlaybookCommand.execute({
      ...SCOPE,
      playbookId: PLAYBOOK_ID,
      playbook: { code: 'nda', name: 'NDA review' },
    }, ctx)
    expect(created.version).toBe(1)
    expect(created.before.existed).toBe(false)

    const updated = await updateReviewPlaybookCommand.execute({
      ...SCOPE,
      playbook: { id: PLAYBOOK_ID, name: 'Mutual NDA review', expectedUpdatedAt: created.updatedAt },
    }, ctx)
    expect(updated.version).toBe(2)
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(new Date(created.updatedAt).getTime())
    expect(mockStore.playbooks[0]?.name).toBe('Mutual NDA review')
  })

  it('rejects a duplicate playbook code in the same organization', async () => {
    seedPlaybook(OTHER_PLAYBOOK_ID, 'nda')
    const ctx = makeContext(makeEntityManager())
    await expectHttpError(createReviewPlaybookCommand.execute({
      ...SCOPE,
      playbookId: PLAYBOOK_ID,
      playbook: { code: 'nda', name: 'Second NDA' },
    }, ctx), 409, 'documents.reviewPlaybooks.errors.codeTaken')
  })

  it('allows reusing the code of a deleted playbook', async () => {
    seedPlaybook(OTHER_PLAYBOOK_ID, 'nda', { deletedAt: new Date('2026-11-10T00:00:00.000Z') })
    const ctx = makeContext(makeEntityManager())
    const created = await createReviewPlaybookCommand.execute({
      ...SCOPE,
      playbookId: PLAYBOOK_ID,
      playbook: { code: 'nda', name: 'NDA review' },
    }, ctx)
    expect(created.id).toBe(PLAYBOOK_ID)
  })

  it('stale expectedUpdatedAt on update yields a 409', async () => {
    seedPlaybook(PLAYBOOK_ID, 'nda')
    const ctx = makeContext(makeEntityManager())
    await expectHttpError(updateReviewPlaybookCommand.execute({
      ...SCOPE,
      playbook: { id: PLAYBOOK_ID, name: 'Changed', expectedUpdatedAt: '2026-11-01T00:00:00.000Z' },
    }, ctx), 409)
  })

  it('refuses callers without the manage feature', async () => {
    mockFeatures.mockResolvedValueOnce(['documents.view'])
    const ctx = makeContext(makeEntityManager())
    await expectHttpError(createReviewPlaybookCommand.execute({
      ...SCOPE,
      playbookId: PLAYBOOK_ID,
      playbook: { code: 'nda', name: 'NDA review' },
    }, ctx), 403)
  })
})

describe('review rule commands', () => {
  it('bumps the playbook version on create, update and delete without touching its lock token', async () => {
    const playbook = seedPlaybook(PLAYBOOK_ID, 'nda')
    const lockToken = playbook.updatedAt.toISOString()
    const ctx = makeContext(makeEntityManager())
    const ruleId = nextId()
    const created = await createReviewRuleCommand.execute({
      ...SCOPE,
      ruleId,
      rule: { playbookId: PLAYBOOK_ID, code: 'NDA-3.1', title: 'Confidentiality term', position: 'Two years at most.', severity: 'blocking' },
    }, ctx)
    expect(created.playbookVersion).toBe(2)
    const updated: ReviewRuleCommandResult = await updateReviewRuleCommand.execute({
      ...SCOPE,
      rule: { id: ruleId, title: 'Confidentiality period', expectedUpdatedAt: created.updatedAt },
    }, ctx)
    expect(updated.playbookVersion).toBe(3)
    const deleted = await deleteReviewRuleCommand.execute({ ...SCOPE, ruleId, expectedUpdatedAt: updated.updatedAt }, ctx)
    expect(deleted.playbookVersion).toBe(4)
    expect(mockStore.playbooks[0]?.version).toBe(4)
    expect(mockStore.playbooks[0]?.updatedAt.toISOString()).toBe(lockToken)
    expect(mockStore.rules[0]?.deletedAt).toBeInstanceOf(Date)
  })

  it('keeps rule codes unique per playbook only', async () => {
    seedPlaybook(PLAYBOOK_ID, 'nda')
    seedPlaybook(OTHER_PLAYBOOK_ID, 'msa')
    seedRule(PLAYBOOK_ID, 'NDA-3.1')
    const ctx = makeContext(makeEntityManager())
    await expectHttpError(createReviewRuleCommand.execute({
      ...SCOPE,
      ruleId: nextId(),
      rule: { playbookId: PLAYBOOK_ID, code: 'NDA-3.1', title: 'Duplicate', position: 'Any.', severity: 'info' },
    }, ctx), 409, 'documents.reviewPlaybooks.errors.ruleCodeTaken')
    const other = await createReviewRuleCommand.execute({
      ...SCOPE,
      ruleId: nextId(),
      rule: { playbookId: OTHER_PLAYBOOK_ID, code: 'NDA-3.1', title: 'Same code elsewhere', position: 'Any.', severity: 'info' },
    }, ctx)
    expect(other.playbookId).toBe(OTHER_PLAYBOOK_ID)
  })

  it('enforces the active rule cap but accepts inactive rules', async () => {
    seedPlaybook(PLAYBOOK_ID, 'nda')
    for (let index = 0; index < DOCUMENTS_MAX_ACTIVE_RULES_PER_PLAYBOOK; index += 1) seedRule(PLAYBOOK_ID, `R-${index}`)
    const ctx = makeContext(makeEntityManager())
    await expectHttpError(createReviewRuleCommand.execute({
      ...SCOPE,
      ruleId: nextId(),
      rule: { playbookId: PLAYBOOK_ID, code: 'R-extra', title: 'Extra', position: 'Any.', severity: 'info' },
    }, ctx), 422, 'documents.reviewPlaybooks.errors.ruleLimit')
    const inactive = await createReviewRuleCommand.execute({
      ...SCOPE,
      ruleId: nextId(),
      rule: { playbookId: PLAYBOOK_ID, code: 'R-draft', title: 'Draft', position: 'Any.', severity: 'info', isActive: false },
    }, ctx)
    expect(inactive.after.isActive).toBe(false)
  })

  it('undo of a rule create soft-deletes it and bumps the playbook version again', async () => {
    seedPlaybook(PLAYBOOK_ID, 'nda')
    const ctx = makeContext(makeEntityManager())
    const input = {
      ...SCOPE,
      ruleId: nextId(),
      rule: { playbookId: PLAYBOOK_ID, code: 'NDA-1', title: 'Parties', position: 'Mutual.', severity: 'warning' as const },
    }
    const created = await createReviewRuleCommand.execute(input, ctx)
    await createReviewRuleCommand.undo!({
      input,
      ctx,
      logEntry: { commandPayload: { undo: { before: created.before, after: created.after }, __redoInput: input } },
    })
    expect(mockStore.rules[0]?.deletedAt).toBeInstanceOf(Date)
    expect(mockStore.playbooks[0]?.version).toBe(3)
  })
})

describe('review playbook reference commands', () => {
  it('rejects duplicates and enforces the guidance cap', async () => {
    seedPlaybook(PLAYBOOK_ID, 'nda')
    const ctx = makeContext(makeEntityManager())
    await createReviewPlaybookReferenceCommand.execute({
      ...SCOPE,
      referenceId: nextId(),
      playbookId: PLAYBOOK_ID,
      documentId: DOCUMENT_ID,
    }, ctx)
    expect(mockAssertCapability).toHaveBeenCalledWith(ctx, expect.anything(), DOCUMENT_ID, SCOPE, 'canView')
    await expectHttpError(createReviewPlaybookReferenceCommand.execute({
      ...SCOPE,
      referenceId: nextId(),
      playbookId: PLAYBOOK_ID,
      documentId: DOCUMENT_ID,
    }, ctx), 409, 'documents.reviewPlaybooks.errors.referenceExists')

    for (let index = 1; index < DOCUMENTS_MAX_REFERENCES_PER_PLAYBOOK; index += 1) {
      mockStore.references.push(Object.assign(new DocumentReviewPlaybookReference(), {
        id: nextId(),
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        playbookId: PLAYBOOK_ID,
        documentId: nextId(),
        deletedAt: null,
        updatedAt: new Date(),
      }))
    }
    await expectHttpError(createReviewPlaybookReferenceCommand.execute({
      ...SCOPE,
      referenceId: nextId(),
      playbookId: PLAYBOOK_ID,
      documentId: nextId(),
    }, ctx), 422, 'documents.reviewPlaybooks.errors.referenceLimit')
  })

  it('refuses a document the caller cannot view', async () => {
    seedPlaybook(PLAYBOOK_ID, 'nda')
    mockAssertCapability.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }))
    const ctx = makeContext(makeEntityManager())
    await expect(createReviewPlaybookReferenceCommand.execute({
      ...SCOPE,
      referenceId: nextId(),
      playbookId: PLAYBOOK_ID,
      documentId: DOCUMENT_ID,
    }, ctx)).rejects.toMatchObject({ status: 403 })
    expect(mockStore.references).toHaveLength(0)
  })
})

describe('finding ingest playbook resolution', () => {
  it('links known rule codes, snapshots the playbook version and keeps unknown codes unresolved', async () => {
    seedPlaybook(PLAYBOOK_ID, 'nda', { version: 7 })
    const rule = seedRule(PLAYBOOK_ID, 'NDA-3.1')
    seedRule(PLAYBOOK_ID, 'NDA-9', { deletedAt: new Date('2026-11-01T00:00:00.000Z') })
    const ctx = makeContext(makeEntityManager())
    await ingestFindingsCommand.execute({
      documentId: DOCUMENT_ID,
      playbookCode: 'nda',
      findings: [
        { severity: 'blocking', title: 'Term', explanation: 'Too long.', quote: 'five years', ruleCode: 'NDA-3.1' },
        { severity: 'warning', title: 'Unknown', explanation: 'No rule.', quote: 'other text', ruleCode: 'NDA-404' },
        { severity: 'info', title: 'Deleted rule', explanation: 'Gone.', quote: 'third', ruleCode: 'NDA-9' },
      ],
    }, ctx)
    const [linked, unknown, deleted] = mockStore.findings
    expect(linked).toMatchObject({ playbookId: PLAYBOOK_ID, playbookVersion: 7, ruleId: rule.id, ruleCode: 'NDA-3.1' })
    expect(unknown).toMatchObject({ playbookId: PLAYBOOK_ID, playbookVersion: 7, ruleId: null, ruleCode: 'NDA-404' })
    expect(deleted).toMatchObject({ ruleId: null, ruleCode: 'NDA-9' })
  })

  it('stores no playbook link for an unknown playbook code', async () => {
    const ctx = makeContext(makeEntityManager())
    await ingestFindingsCommand.execute({
      documentId: DOCUMENT_ID,
      playbookCode: 'missing',
      findings: [{ severity: 'warning', title: 'Term', explanation: 'Check.', quote: 'five years', ruleCode: 'NDA-3.1' }],
    }, ctx)
    expect(mockStore.findings[0]).toMatchObject({ playbookId: null, playbookVersion: null, ruleId: null, ruleCode: 'NDA-3.1' })
  })
})
