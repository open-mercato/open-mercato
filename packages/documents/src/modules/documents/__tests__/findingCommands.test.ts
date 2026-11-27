import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Document, DocumentFinding } from '../data/entities'

type Row = Record<string, unknown>

const mockStore: { findings: DocumentFinding[]; document: Document | null } = { findings: [], document: null }
const mockAssertCapability = jest.fn(async () => [])

function mockMatches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key]
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && '$in' in expected) {
      return ((expected as { $in: unknown[] }).$in).includes(actual)
    }
    if (expected === null) return actual === null || actual === undefined
    return actual === expected
  })
}

function mockQuery(entity: unknown, where: Row, options?: { orderBy?: Row; limit?: number }): Row[] {
  if (entity === Document) {
    const document = mockStore.document as unknown as Row | null
    return document && mockMatches(document, where) ? [document] : []
  }
  const rows = (mockStore.findings as unknown as Row[]).filter((row) => mockMatches(row, where))
  if (options?.orderBy) {
    rows.sort((left, right) => (right.createdAt as Date).getTime() - (left.createdAt as Date).getTime())
  }
  return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (_em: unknown, entity: unknown, where: Row, options?: { orderBy?: Row; limit?: number }) => (
    mockQuery(entity, where, options)
  )),
  findOneWithDecryption: jest.fn(async (_em: unknown, entity: unknown, where: Row, options?: { orderBy?: Row }) => (
    mockQuery(entity, where, options)[0] ?? null
  )),
}))

jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return {
    ...actual,
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
  applyFindingCommand,
  ingestFindingsCommand,
  keepFindingCommand,
  reopenFindingCommand,
  type FindingDecisionCommandResult,
  type FindingIngestCommandInput,
  type FindingIngestCommandResult,
} from '../commands/findings'
import { isReviewClearedTransition } from '../lib/findingSummary'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'

function makeEntityManager(): EntityManager {
  let createdSequence = 0
  const em = {
    fork: jest.fn(() => em),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    isInTransaction: jest.fn(() => false),
    create: jest.fn((entity: new () => object, data: Row) => {
      createdSequence += 1
      return Object.assign(new entity(), data, {
        createdAt: new Date(Date.now() + createdSequence),
        updatedAt: new Date('2026-11-12T10:00:00.000Z'),
      })
    }),
    persist: jest.fn((entity: DocumentFinding) => {
      mockStore.findings.push(entity)
    }),
    count: jest.fn(async (_entity: unknown, where: Row) => mockQuery(DocumentFinding, where).length),
  }
  return em as unknown as EntityManager
}

function makeContext(em: EntityManager): CommandRuntimeContext {
  return {
    container: { resolve: (name: string) => (name === 'em' ? em : null) } as CommandRuntimeContext['container'],
    auth: { sub: USER_ID, userId: USER_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
  }
}

function ingestInput(overrides: Partial<FindingIngestCommandInput> = {}): FindingIngestCommandInput {
  return {
    documentId: DOCUMENT_ID,
    findings: [
      {
        severity: 'blocking',
        title: 'Confidentiality term too long',
        explanation: 'The term exceeds the standard position.',
        quote: 'five years',
        suggestedText: 'two years',
      },
      {
        severity: 'warning',
        title: 'Governing law',
        explanation: 'Prefer the home jurisdiction.',
        quote: 'laws of the other party',
      },
    ],
    ...overrides,
  }
}

function eventIds(result: { projections: Array<{ kind: string; eventId?: string }> }): string[] {
  return result.projections.flatMap((projection) => (projection.kind === 'event' && projection.eventId ? [projection.eventId] : []))
}

async function ingest(ctx: CommandRuntimeContext, overrides: Partial<FindingIngestCommandInput> = {}): Promise<FindingIngestCommandResult> {
  return ingestFindingsCommand.execute(ingestInput(overrides), ctx)
}

function decisionBase(finding: DocumentFinding) {
  return {
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    documentId: DOCUMENT_ID,
    findingId: finding.id,
    actorUserId: USER_ID,
    expectedUpdatedAt: finding.updatedAt.toISOString(),
  }
}

async function logEntryFor<TInput, TResult>(
  command: { buildLog?: (args: { input: TInput; result: TResult; ctx: CommandRuntimeContext }) => unknown },
  input: TInput,
  result: TResult,
  ctx: CommandRuntimeContext,
): Promise<{ commandPayload: unknown; context: { emittedEvents: string[] } }> {
  const log = await command.buildLog?.({ input, result, ctx }) as { payload: unknown; context: { emittedEvents: string[] } }
  return { commandPayload: JSON.parse(JSON.stringify(log.payload)), context: log.context }
}

function findingByTitle(title: string, status = 'open'): DocumentFinding {
  const finding = mockStore.findings.find((row) => row.title === title && row.status === status && !row.deletedAt)
  if (!finding) throw new Error(`[internal] missing finding ${title}`)
  return finding
}

function locatedFinding(title: string): DocumentFinding {
  const finding = findingByTitle(title)
  finding.anchorStatus = 'located'
  return finding
}

describe('review finding commands', () => {
  let em: EntityManager
  let ctx: CommandRuntimeContext

  beforeEach(() => {
    mockStore.findings = []
    mockStore.document = Object.assign(new Document(), {
      id: DOCUMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      title: 'Agreement',
      ownerUserId: USER_ID,
      createdByUserId: USER_ID,
      deletedAt: null,
    })
    mockAssertCapability.mockClear()
    em = makeEntityManager()
    ctx = makeContext(em)
  })

  it('ingests open findings, marks missing passages unlocated and does not clear a review with blocking findings', async () => {
    const result = await ingest(ctx)
    expect(result).toMatchObject({ created: 2, superseded: 0, unlocated: 2, reviewCleared: false })
    expect(result.counts).toEqual({ blocking: 1, warning: 1, info: 0 })
    expect(eventIds(result)).toEqual(['documents.finding.ingested'])
    expect(mockStore.findings.every((finding) => finding.status === 'open' && finding.anchorStatus === 'unlocated')).toBe(true)
    expect(mockAssertCapability).toHaveBeenCalledWith(expect.anything(), expect.anything(), DOCUMENT_ID, expect.anything(), 'canEdit')
  })

  it('emits review.cleared directly when the batch has no blocking finding', async () => {
    const result = await ingest(ctx, {
      findings: [{ severity: 'info', title: 'Note', explanation: 'Advisory.', quote: 'anything' }],
    })
    expect(result.reviewCleared).toBe(true)
    expect(eventIds(result)).toEqual(['documents.finding.ingested', 'documents.review.cleared'])
  })

  it('supersedes only earlier open findings of the same source and keeps decided ones', async () => {
    await ingest(ctx)
    const kept = findingByTitle('Governing law')
    await keepFindingCommand.execute({ ...decisionBase(kept), note: null }, ctx)
    await ingest(ctx, {
      source: 'import',
      findings: [{ severity: 'info', title: 'Imported', explanation: 'From import.', quote: 'x' }],
    })
    const second = await ingest(ctx)
    expect(second.superseded).toBe(1)
    expect(mockStore.findings.filter((finding) => finding.status === 'superseded').map((finding) => finding.title))
      .toEqual(['Confidentiality term too long'])
    expect(findingByTitle('Governing law', 'kept').status).toBe('kept')
    expect(findingByTitle('Imported').status).toBe('open')
  })

  it('rejects keep without a note for blocking findings and apply without a suggestion', async () => {
    await ingest(ctx)
    const blocking = findingByTitle('Confidentiality term too long')
    const warning = findingByTitle('Governing law')
    await expect(keepFindingCommand.execute({ ...decisionBase(blocking), note: '  ' }, ctx))
      .rejects.toMatchObject({ status: 422, body: { error: 'documents.findings.noteRequired' } })
    await expect(applyFindingCommand.execute({ ...decisionBase(warning), appliedText: 'x' }, ctx))
      .rejects.toMatchObject({ status: 422, body: { error: 'documents.findings.noSuggestion' } })
    await expect(applyFindingCommand.execute({ ...decisionBase(blocking), appliedText: 'two years' }, ctx))
      .rejects.toMatchObject({ status: 422, body: { error: 'documents.findings.unlocated' } })
    expect(blocking.status).toBe('open')
    const kept = await keepFindingCommand.execute({ ...decisionBase(warning) }, ctx)
    expect(kept.finding).toMatchObject({ status: 'kept', decisionNote: null, decidedByUserId: USER_ID })
  })

  it('rejects stale expectedUpdatedAt and decisions on findings that are not open', async () => {
    await ingest(ctx)
    const blocking = locatedFinding('Confidentiality term too long')
    await expect(applyFindingCommand.execute({
      ...decisionBase(blocking),
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      appliedText: 'two years',
    }, ctx)).rejects.toMatchObject({ status: 409 })
    const applied = await applyFindingCommand.execute({ ...decisionBase(blocking), appliedText: 'two years' }, ctx)
    expect(applied.finding).toMatchObject({ status: 'applied', appliedText: 'two years' })
    await expect(keepFindingCommand.execute({ ...decisionBase(blocking), note: 'late' }, ctx))
      .rejects.toMatchObject({ status: 409, body: { error: 'documents.findings.notOpen' } })
    const warning = findingByTitle('Governing law')
    await expect(reopenFindingCommand.execute(decisionBase(warning), ctx))
      .rejects.toMatchObject({ status: 409, body: { error: 'documents.findings.notDecided' } })
  })

  it('emits review.cleared on each transition to zero open blocking findings only', async () => {
    await ingest(ctx, {
      findings: [
        { severity: 'blocking', title: 'First', explanation: 'A', quote: 'a', suggestedText: 'b' },
        { severity: 'blocking', title: 'Second', explanation: 'B', quote: 'c' },
        { severity: 'warning', title: 'Third', explanation: 'C', quote: 'd' },
      ],
    })
    const warningResult = await keepFindingCommand.execute({ ...decisionBase(findingByTitle('Third')) }, ctx)
    expect(eventIds(warningResult)).toEqual(['documents.finding.kept'])
    const first = await applyFindingCommand.execute({ ...decisionBase(locatedFinding('First')), appliedText: 'b' }, ctx)
    expect(eventIds(first)).toEqual(['documents.finding.applied'])
    const second = await keepFindingCommand.execute({ ...decisionBase(findingByTitle('Second')), note: 'Accepted risk' }, ctx)
    expect(eventIds(second)).toEqual(['documents.finding.kept', 'documents.review.cleared'])
    const reopened = await reopenFindingCommand.execute(decisionBase(findingByTitle('Second', 'kept')), ctx)
    expect(eventIds(reopened)).toEqual(['documents.finding.reopened'])
    expect(reopened.finding).toMatchObject({ status: 'open', decisionNote: null, decidedAt: null })
    const again = await keepFindingCommand.execute({ ...decisionBase(findingByTitle('Second')), note: 'Still accepted' }, ctx)
    expect(eventIds(again)).toEqual(['documents.finding.kept', 'documents.review.cleared'])
    const thirdReopen = await reopenFindingCommand.execute(decisionBase(findingByTitle('Third', 'kept')), ctx)
    expect(eventIds(thirdReopen)).toEqual(['documents.finding.reopened'])
    const thirdKeep = await keepFindingCommand.execute({ ...decisionBase(findingByTitle('Third')) }, ctx)
    expect(eventIds(thirdKeep)).toEqual(['documents.finding.kept'])
  })

  it('does not emit review.cleared for decisions on an older review', async () => {
    await ingest(ctx, {
      findings: [{ severity: 'blocking', title: 'Old', explanation: 'A', quote: 'a' }],
    })
    await ingest(ctx, {
      supersede: false,
      findings: [{ severity: 'blocking', title: 'New', explanation: 'B', quote: 'b' }],
    })
    const old = await keepFindingCommand.execute({ ...decisionBase(findingByTitle('Old')), note: 'ok' }, ctx)
    expect(eventIds(old)).toEqual(['documents.finding.kept'])
  })

  it('undoes a keep by restoring the open state and records emitted events in the log context', async () => {
    await ingest(ctx)
    const warning = findingByTitle('Governing law')
    const input = { ...decisionBase(warning), note: 'fine' }
    const result: FindingDecisionCommandResult = await keepFindingCommand.execute(input, ctx)
    const logEntry = await logEntryFor(keepFindingCommand, input, result, ctx)
    expect(logEntry.context.emittedEvents).toEqual(['documents.finding.kept'])
    await keepFindingCommand.undo?.({ logEntry, ctx } as never)
    expect(warning).toMatchObject({ status: 'open', decisionNote: null, decidedByUserId: null, decidedAt: null })
  })

  it('undoes an ingest by removing created findings and restoring superseded ones', async () => {
    await ingest(ctx)
    const previous = findingByTitle('Confidentiality term too long')
    const secondInput = ingestInput({
      findings: [{ severity: 'warning', title: 'Replacement', explanation: 'R', quote: 'r' }],
    })
    const second = await ingestFindingsCommand.execute(secondInput, ctx)
    expect(previous.status).toBe('superseded')
    const logEntry = await logEntryFor(ingestFindingsCommand, secondInput, second, ctx)
    await ingestFindingsCommand.undo?.({ logEntry, ctx } as never)
    expect(previous.status).toBe('open')
    expect(mockStore.findings.find((finding) => finding.title === 'Replacement')?.deletedAt).toBeInstanceOf(Date)
  })

  it('refuses to undo an ingest after one of its findings was decided', async () => {
    const input = ingestInput()
    const result = await ingestFindingsCommand.execute(input, ctx)
    const logEntry = await logEntryFor(ingestFindingsCommand, input, result, ctx)
    const warning = findingByTitle('Governing law')
    await keepFindingCommand.execute({ ...decisionBase(warning) }, ctx)
    await expect(ingestFindingsCommand.undo?.({ logEntry, ctx } as never))
      .rejects.toMatchObject({ status: 409, body: { error: 'documents.findings.undoConflict' } })
  })

  it('detects the cleared transition only from a positive count to zero', () => {
    expect(isReviewClearedTransition(1, 0)).toBe(true)
    expect(isReviewClearedTransition(0, 0)).toBe(false)
    expect(isReviewClearedTransition(null, 0)).toBe(false)
    expect(isReviewClearedTransition(2, 1)).toBe(false)
  })
})
