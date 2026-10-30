/** @jest-environment node */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  Attachment,
  AttachmentDocumentExtraction,
  AttachmentDocumentSection,
  AttachmentPartition,
} from '../../../data/entities'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { runDocumentStructureExtraction, type DocumentStructureWorkerDeps } from '../../../workers/document-structure'
import { DocumentStructurePdfEncryptedError } from '../engines/pdfLayout'
import type { OcrStructureOptions } from '../engines/ocr'
import { throwIfDocumentStructureAborted } from '../engines/text'
import type { DocumentEngineResult, DocumentStructureEngine } from '../types'
import { DOCUMENT_STRUCTURE_QUEUE_DI_KEY, enqueueDocumentStructureExtraction } from '../queue'

type Row = Record<string, unknown>
type EntityClass = abstract new (...args: never[]) => object

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (em: { __find: (entity: unknown, where: Row) => Row[] }, entity: unknown, where: Row) =>
    em.__find(entity, where)[0] ?? null,
  ),
  findWithDecryption: jest.fn(async (em: { __find: (entity: unknown, where: Row) => Row[] }, entity: unknown, where: Row) =>
    em.__find(entity, where),
  ),
}))

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const TENANT_B = '33333333-3333-4333-8333-333333333333'
const ORG_B = '44444444-4444-4444-8444-444444444444'
const ATTACHMENT_ID = '55555555-5555-4555-8555-555555555555'

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => (row[key] ?? null) === (value ?? null))
}

function createFakeEm() {
  const tables = new Map<unknown, Row[]>([
    [Attachment, []],
    [AttachmentPartition, []],
    [AttachmentDocumentExtraction, []],
    [AttachmentDocumentSection, []],
  ])
  const table = (entity: unknown): Row[] => {
    const rows = tables.get(entity)
    if (!rows) throw new Error('unknown entity')
    return rows
  }
  const pending: Array<{ entity: unknown; row: Row }> = []
  const em = {
    __find: (entity: unknown, where: Row) => table(entity).filter((row) => matches(row, where)),
    create: (entity: EntityClass, data: Row) => ({ __entity: entity, ...data }),
    persist: (row: Row) => {
      pending.push({ entity: row.__entity, row })
      return em
    },
    flush: async () => {
      for (const entry of pending.splice(0)) {
        const { __entity: _ignored, ...rest } = entry.row
        table(entry.entity).push(rest)
      }
    },
    nativeUpdate: async (entity: unknown, where: Row, data: Row) => {
      const rows = table(entity).filter((row) => matches(row, where))
      for (const row of rows) Object.assign(row, data)
      return rows.length
    },
    transactional: async <T>(work: (tx: typeof em) => Promise<T>) => work(em),
  }
  return { em, table }
}

type FakeEm = ReturnType<typeof createFakeEm>

let tempDir: string

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'om-structure-worker-'))
})

afterAll(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

async function writeFile(name: string, content: string): Promise<string> {
  const filePath = path.join(tempDir, name)
  await fs.writeFile(filePath, content)
  return filePath
}

function seed(
  fake: FakeEm,
  options: {
    fileName: string
    mimeType: string
    extractDocumentStructure?: boolean
    requiresOcr?: boolean
    tenantId?: string | null
    organizationId?: string | null
  },
) {
  fake.table(AttachmentPartition).push({
    code: 'privateAttachments',
    extractDocumentStructure: options.extractDocumentStructure ?? true,
    requiresOcr: options.requiresOcr ?? false,
    ocrModel: null,
  })
  fake.table(Attachment).push({
    id: ATTACHMENT_ID,
    tenantId: options.tenantId === undefined ? TENANT_A : options.tenantId,
    organizationId: options.organizationId === undefined ? ORG_A : options.organizationId,
    partitionCode: 'privateAttachments',
    fileName: options.fileName,
    mimeType: options.mimeType,
    storagePath: options.fileName,
  })
}

function textResult(text: string): DocumentEngineResult {
  return {
    blocks: [{ text, page: null, source: 'text' }],
    pageCount: null,
    pageCharCounts: [],
    outline: [],
    ocrPageCount: 0,
    unreadablePages: [],
  }
}

function fakeEngine(
  id: DocumentStructureEngine['id'],
  version: number,
  extract: DocumentStructureEngine['extract'],
  supports: (mimeType: string) => boolean,
): DocumentStructureEngine {
  return { id, version, supports, extract: jest.fn(extract) }
}

function buildDeps(
  fake: FakeEm,
  filePath: string,
  engines: DocumentStructureEngine[],
  overrides: Partial<DocumentStructureWorkerDeps> = {},
): DocumentStructureWorkerDeps & { cleanup: jest.Mock; resolveForPartition: jest.Mock } {
  const cleanup = jest.fn(async () => undefined)
  const resolveForPartition = jest.fn(async () => ({
    toLocalPath: jest.fn(async () => ({ filePath, cleanup })),
  }))
  return {
    em: fake.em as unknown as EntityManager,
    storageDriverFactory: { resolveForPartition } as unknown as DocumentStructureWorkerDeps['storageDriverFactory'],
    registry: { resolve: (mimeType: string) => engines.find((engine) => engine.supports(mimeType)) ?? null },
    ...overrides,
    cleanup,
    resolveForPartition,
  }
}

const textEngine = (version = 1, text = '1. Scope\n\nThis rulebook applies to everyone.') =>
  fakeEngine('text', version, async () => textResult(text), (mimeType) => mimeType === 'text/plain')

const job = { attachmentId: ATTACHMENT_ID, tenantId: TENANT_A, organizationId: ORG_A }

function liveExtractions(fake: FakeEm): Row[] {
  return fake.table(AttachmentDocumentExtraction).filter((row) => row.deletedAt === null)
}

describe('document structure worker', () => {
  it('persists a completed extraction with encrypted-field sections scoped like the attachment', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain' })
    const filePath = await writeFile('rules.txt', 'rules v1')
    const deps = buildDeps(fake, filePath, [textEngine()])

    const outcome = await runDocumentStructureExtraction(job, deps)

    expect(outcome).toEqual(expect.objectContaining({ kind: 'persisted', status: 'completed' }))
    const [extraction] = liveExtractions(fake)
    expect(extraction).toEqual(
      expect.objectContaining({
        tenantId: TENANT_A,
        organizationId: ORG_A,
        engine: 'text',
        engineVersion: 1,
        status: 'completed',
        contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    )
    const sections = fake.table(AttachmentDocumentSection)
    expect(sections.length).toBeGreaterThan(0)
    for (const section of sections) {
      expect(section).toEqual(
        expect.objectContaining({ extractionId: extraction.id, tenantId: TENANT_A, organizationId: ORG_A }),
      )
      expect(section.textSha256).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(deps.resolveForPartition).toHaveBeenCalledWith('privateAttachments', {
      tenantId: TENANT_A,
      organizationId: ORG_A,
    })
    expect(deps.cleanup).toHaveBeenCalled()
  })

  it('reuses the live extraction for the same content hash and engine version', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain' })
    const filePath = await writeFile('rules-idem.txt', 'rules idempotent')
    const engine = textEngine()
    const deps = buildDeps(fake, filePath, [engine])

    const first = await runDocumentStructureExtraction(job, deps)
    const second = await runDocumentStructureExtraction(job, deps)

    expect(first.kind).toBe('persisted')
    expect(second).toEqual({ kind: 'reused', extractionId: first.kind === 'persisted' ? first.extractionId : '' })
    expect(fake.table(AttachmentDocumentExtraction)).toHaveLength(1)
    expect(engine.extract).toHaveBeenCalledTimes(1)
  })

  it('re-extracts with force and supersedes the previous live extraction', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain' })
    const filePath = await writeFile('rules-force.txt', 'rules forced')
    const deps = buildDeps(fake, filePath, [textEngine()])

    await runDocumentStructureExtraction(job, deps)
    const forced = await runDocumentStructureExtraction({ ...job, force: true }, deps)

    expect(forced.kind).toBe('persisted')
    expect(fake.table(AttachmentDocumentExtraction)).toHaveLength(2)
    const live = liveExtractions(fake)
    expect(live).toHaveLength(1)
    expect(live[0].id).toBe(forced.kind === 'persisted' ? forced.extractionId : null)
  })

  it('supersedes the previous extraction on an engine version bump', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain' })
    const filePath = await writeFile('rules-bump.txt', 'rules bump')

    await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [textEngine(1)]))
    const bumped = await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [textEngine(2)]))

    expect(bumped.kind).toBe('persisted')
    const live = liveExtractions(fake)
    expect(live).toHaveLength(1)
    expect(live[0].engineVersion).toBe(2)
  })

  it('does nothing when the partition has structure extraction disabled', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain', extractDocumentStructure: false })
    const filePath = await writeFile('rules-off.txt', 'rules off')
    const deps = buildDeps(fake, filePath, [textEngine()])

    const outcome = await runDocumentStructureExtraction(job, deps)

    expect(outcome).toEqual({ kind: 'disabled' })
    expect(fake.table(AttachmentDocumentExtraction)).toHaveLength(0)
    expect(deps.resolveForPartition).not.toHaveBeenCalled()
  })

  it('runs an on-demand request even when the partition has structure extraction disabled', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain', extractDocumentStructure: false })
    const filePath = await writeFile('rules-on-demand.txt', 'rules on demand')

    const outcome = await runDocumentStructureExtraction({ ...job, onDemand: true }, buildDeps(fake, filePath, [textEngine()]))

    expect(outcome.kind).toBe('persisted')
    expect(liveExtractions(fake)).toHaveLength(1)
  })

  it('marks unsupported types as skipped', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'archive.zip', mimeType: 'application/zip' })
    const filePath = await writeFile('archive.zip', 'zip bytes')

    const outcome = await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [textEngine()]))

    expect(outcome).toEqual(expect.objectContaining({ kind: 'persisted', status: 'skipped' }))
    expect(liveExtractions(fake)[0]).toEqual(expect.objectContaining({ skipReason: 'unsupported_type' }))
    expect(fake.table(AttachmentDocumentSection)).toHaveLength(0)
  })

  it('marks files above the size cap as skipped too_large', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain' })
    const filePath = await writeFile('rules-large.txt', 'x'.repeat(64))
    const engine = textEngine()

    await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [engine], { maxBytes: 16 }))

    expect(liveExtractions(fake)[0]).toEqual(expect.objectContaining({ status: 'skipped', skipReason: 'too_large' }))
    expect(engine.extract).not.toHaveBeenCalled()
  })

  it('marks encrypted PDFs as skipped', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'locked.pdf', mimeType: 'application/pdf' })
    const filePath = await writeFile('locked.pdf', '%PDF locked')
    const pdfEngine = fakeEngine('pdf_layout', 1, async () => {
      throw new DocumentStructurePdfEncryptedError()
    }, (mimeType) => mimeType === 'application/pdf')

    await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [pdfEngine]))

    expect(liveExtractions(fake)[0]).toEqual(expect.objectContaining({ status: 'skipped', skipReason: 'encrypted_pdf' }))
  })

  it('marks a PDF without a text layer as skipped when OCR is disabled', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'scan.pdf', mimeType: 'application/pdf', requiresOcr: false })
    const filePath = await writeFile('scan.pdf', '%PDF scan')
    const pdfEngine = fakeEngine('pdf_layout', 1, async () => ({
      blocks: [],
      pageCount: 2,
      pageCharCounts: [0, 0],
      outline: [],
      ocrPageCount: 0,
      unreadablePages: [1, 2],
    }), (mimeType) => mimeType === 'application/pdf')

    await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [pdfEngine]))

    expect(liveExtractions(fake)[0]).toEqual(
      expect.objectContaining({ status: 'skipped', skipReason: 'no_text_layer_ocr_disabled' }),
    )
  })

  it('marks the extraction partial when OCR pages exceed the cap', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'mixed.pdf', mimeType: 'application/pdf', requiresOcr: true })
    const filePath = await writeFile('mixed.pdf', '%PDF mixed')
    const pdfEngine = fakeEngine('pdf_layout', 1, async () => ({
      blocks: [{ text: '1. Scope of the rules', page: 1, source: 'text_layer' }],
      pageCount: 3,
      pageCharCounts: [120, 0, 0],
      outline: [],
      ocrPageCount: 0,
      unreadablePages: [2, 3],
    }), (mimeType) => mimeType === 'application/pdf')
    const processImageBuffer = jest.fn(async () => 'Recovered page text')
    const ocrOptions: OcrStructureOptions = {
      ocrService: () => ({ available: true, processImageBuffer }),
      preparePdfPages: async (_filePath, options) => ({
        pages: (options.pageNumbers ?? []).map((pageNumber) => ({ pageNumber, imageBuffer: Buffer.from('png') })),
      }) as unknown as Awaited<ReturnType<NonNullable<OcrStructureOptions['preparePdfPages']>>>,
      runInSlot: async (run) => run(),
      maxPages: () => 1,
    }

    const outcome = await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [pdfEngine], { ocrOptions }))

    expect(outcome).toEqual(expect.objectContaining({ kind: 'persisted', status: 'partial' }))
    expect(processImageBuffer).toHaveBeenCalledTimes(1)
    expect(liveExtractions(fake)[0]).toEqual(
      expect.objectContaining({ engine: 'mixed', ocrPageCount: 1, status: 'partial' }),
    )
  })

  it('marks the extraction partial when the engine stopped at the page cap', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'long.pdf', mimeType: 'application/pdf' })
    const filePath = await writeFile('long.pdf', '%PDF long')
    const pdfEngine = fakeEngine('pdf_layout', 1, async () => ({
      blocks: [{ text: '1. Scope of the rules', page: 1, source: 'text_layer' }],
      pageCount: 5,
      pageCharCounts: [120],
      outline: [],
      ocrPageCount: 0,
      unreadablePages: [],
    }), (mimeType) => mimeType === 'application/pdf')

    const outcome = await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [pdfEngine]))

    expect(outcome).toEqual(expect.objectContaining({ status: 'partial' }))
  })

  it('records a sanitized failure reason when the engine throws', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain' })
    const filePath = await writeFile('rules-fail.txt', 'rules fail')
    const engine = fakeEngine('text', 1, async () => {
      throw new Error('boom at /secret/path/rules.txt\n    at stack frame')
    }, (mimeType) => mimeType === 'text/plain')

    const outcome = await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [engine]))

    expect(outcome).toEqual(expect.objectContaining({ kind: 'persisted', status: 'failed' }))
    const [extraction] = liveExtractions(fake)
    expect(extraction.failureReason).toBe('[internal] document structure extraction failed')
    expect(String(extraction.failureReason)).not.toContain('/secret/path')
  })

  it('fails with a timeout reason when the engine exceeds the time budget', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain' })
    const filePath = await writeFile('rules-slow.txt', 'rules slow')
    const engine = fakeEngine('text', 1, () => new Promise<DocumentEngineResult>(() => undefined), (mimeType) =>
      mimeType === 'text/plain',
    )

    await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [engine], { timeoutMs: 20 }))

    expect(liveExtractions(fake)[0]).toEqual(
      expect.objectContaining({ status: 'failed', failureReason: '[internal] document structure extraction timed out' }),
    )
  })

  it('keeps the previous completed extraction live when a re-extraction fails', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain' })
    const filePath = await writeFile('rules-keep-fail.txt', 'rules keep on failure')
    const first = await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [textEngine()]))
    const failing = fakeEngine('text', 1, async () => {
      throw new Error('engine crashed')
    }, (mimeType) => mimeType === 'text/plain')

    const outcome = await runDocumentStructureExtraction({ ...job, force: true }, buildDeps(fake, filePath, [failing]))

    const previousId = first.kind === 'persisted' ? first.extractionId : null
    expect(outcome).toEqual(expect.objectContaining({ kind: 'failed_previous_kept', previousExtractionId: previousId }))
    const live = liveExtractions(fake)
    expect(live).toHaveLength(1)
    expect(live[0]).toEqual(expect.objectContaining({ id: previousId, status: 'completed' }))
    expect(fake.table(AttachmentDocumentSection).filter((section) => section.extractionId === previousId).length).toBeGreaterThan(0)
    const failed = fake.table(AttachmentDocumentExtraction).find((row) => row.status === 'failed')
    expect(failed).toEqual(
      expect.objectContaining({ deletedAt: expect.any(Date), failureReason: '[internal] document structure extraction failed' }),
    )
  })

  it('keeps the previous completed extraction live when a re-extraction times out', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain' })
    const filePath = await writeFile('rules-keep-timeout.txt', 'rules keep on timeout')
    const first = await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [textEngine()]))
    const slow = fakeEngine('text', 2, () => new Promise<DocumentEngineResult>(() => undefined), (mimeType) =>
      mimeType === 'text/plain',
    )

    const outcome = await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [slow], { timeoutMs: 20 }))

    expect(outcome.kind).toBe('failed_previous_kept')
    const live = liveExtractions(fake)
    expect(live).toHaveLength(1)
    expect(live[0]).toEqual(
      expect.objectContaining({ id: first.kind === 'persisted' ? first.extractionId : null, status: 'completed' }),
    )
  })

  it('re-reads the attachment under a shared row lock before writing so a concurrent delete serializes', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain' })
    const filePath = await writeFile('rules-lock.txt', 'rules lock')
    jest.mocked(findOneWithDecryption).mockClear()

    await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [textEngine()]))

    const lockedReads = jest
      .mocked(findOneWithDecryption)
      .mock.calls.filter(([, entity, , options]) => entity === Attachment && options?.lockMode === LockMode.PESSIMISTIC_READ)
    expect(lockedReads).toHaveLength(1)
    expect(lockedReads[0][2]).toEqual({ id: ATTACHMENT_ID, tenantId: TENANT_A, organizationId: ORG_A })
  })

  it('reuses the extraction a concurrent job committed when the live unique index rejects the insert', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain' })
    const content = 'rules race'
    const filePath = await writeFile('rules-race.txt', content)
    const concurrentId = '99999999-9999-4999-8999-999999999999'
    fake.em.flush = async () => {
      fake.table(AttachmentDocumentExtraction).push({
        id: concurrentId,
        attachmentId: ATTACHMENT_ID,
        tenantId: TENANT_A,
        organizationId: ORG_A,
        contentSha256: createHash('sha256').update(content).digest('hex'),
        engineVersion: 1,
        status: 'completed',
        skipReason: null,
        deletedAt: null,
      })
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
        constraint: 'attachment_document_extractions_live_unique',
      })
    }

    const outcome = await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [textEngine()]))

    expect(outcome).toEqual({ kind: 'reused', extractionId: concurrentId })
    expect(liveExtractions(fake).map((row) => row.id)).toEqual([concurrentId])
  })

  it('rethrows other write failures', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain' })
    const filePath = await writeFile('rules-write-fail.txt', 'rules write fail')
    fake.em.flush = async () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'some_other_unique' })
    }

    await expect(runDocumentStructureExtraction(job, buildDeps(fake, filePath, [textEngine()]))).rejects.toThrow('duplicate key')
  })

  it.each<[string, Partial<DocumentStructureWorkerDeps>]>([
    ['too_large', { maxBytes: 16 }],
    ['unsupported_type', { registry: { resolve: () => null } }],
  ])('re-runs instead of reusing a configuration-dependent %s skip', async (skipReason, firstOverrides) => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain' })
    const filePath = await writeFile(`rules-config-${skipReason}.txt`, 'x'.repeat(64))
    const engine = textEngine()

    const first = await runDocumentStructureExtraction(
      job,
      buildDeps(fake, filePath, [engine], firstOverrides),
    )
    const second = await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [engine]))

    expect(first).toEqual(expect.objectContaining({ kind: 'persisted', status: 'skipped' }))
    expect(fake.table(AttachmentDocumentExtraction).find((row) => row.status === 'skipped')?.skipReason).toBe(skipReason)
    expect(second).toEqual(expect.objectContaining({ kind: 'persisted', status: 'completed' }))
    expect(engine.extract).toHaveBeenCalledTimes(1)
    expect(liveExtractions(fake)).toHaveLength(1)
  })

  it('re-runs with OCR forced instead of reusing a no_text_layer_ocr_disabled skip', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'scan.pdf', mimeType: 'application/pdf', requiresOcr: true })
    const filePath = await writeFile('scan-reuse.pdf', '%PDF scan reuse')
    const pdfEngine = fakeEngine('pdf_layout', 1, async () => ({
      blocks: [],
      pageCount: 1,
      pageCharCounts: [0],
      outline: [],
      ocrPageCount: 0,
      unreadablePages: [1],
    }), (mimeType) => mimeType === 'application/pdf')
    const processImageBuffer = jest.fn(async () => '1. Scope\n\nRecovered page text for the rules')
    const ocrOptions: OcrStructureOptions = {
      ocrService: () => ({ available: true, processImageBuffer }),
      preparePdfPages: async (_filePath, options) => ({
        pages: (options.pageNumbers ?? []).map((pageNumber) => ({ pageNumber, imageBuffer: Buffer.from('png') })),
      }) as unknown as Awaited<ReturnType<NonNullable<OcrStructureOptions['preparePdfPages']>>>,
      runInSlot: async (run) => run(),
      maxPages: () => 5,
    }

    await runDocumentStructureExtraction({ ...job, ocr: 'never' }, buildDeps(fake, filePath, [pdfEngine], { ocrOptions }))
    expect(liveExtractions(fake)[0]).toEqual(expect.objectContaining({ skipReason: 'no_text_layer_ocr_disabled' }))
    const forced = await runDocumentStructureExtraction({ ...job, ocr: 'force' }, buildDeps(fake, filePath, [pdfEngine], { ocrOptions }))

    expect(forced).toEqual(expect.objectContaining({ kind: 'persisted' }))
    expect(processImageBuffer).toHaveBeenCalledTimes(1)
    expect(liveExtractions(fake)[0]).toEqual(expect.objectContaining({ engine: 'ocr', skipReason: null }))
  })

  it('aborts the running engine through its signal when the time budget runs out', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain' })
    const filePath = await writeFile('rules-abort.txt', 'rules abort')
    const observedSignals: AbortSignal[] = []
    const engine = fakeEngine('text', 1, async (input) => {
      const signal = input.signal
      if (signal) observedSignals.push(signal)
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }))
      throwIfDocumentStructureAborted(signal)
      return textResult('never reached')
    }, (mimeType) => mimeType === 'text/plain')

    await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [engine], { timeoutMs: 20 }))

    expect(observedSignals).toHaveLength(1)
    expect(observedSignals[0].aborted).toBe(true)
    expect(liveExtractions(fake)[0]).toEqual(
      expect.objectContaining({ status: 'failed', failureReason: '[internal] document structure extraction timed out' }),
    )
  })

  it('stops OCR between pages when the time budget runs out', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'scan.pdf', mimeType: 'application/pdf', requiresOcr: true })
    const filePath = await writeFile('scan-timeout.pdf', '%PDF scan timeout')
    const pdfEngine = fakeEngine('pdf_layout', 1, async () => ({
      blocks: [],
      pageCount: 3,
      pageCharCounts: [0, 0, 0],
      outline: [],
      ocrPageCount: 0,
      unreadablePages: [1, 2, 3],
    }), (mimeType) => mimeType === 'application/pdf')
    const processImageBuffer = jest.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('Recovered page text'), 60)),
    )
    const ocrOptions: OcrStructureOptions = {
      ocrService: () => ({ available: true, processImageBuffer }),
      preparePdfPages: async (_filePath, options) => ({
        pages: (options.pageNumbers ?? []).map((pageNumber) => ({ pageNumber, imageBuffer: Buffer.from('png') })),
      }) as unknown as Awaited<ReturnType<NonNullable<OcrStructureOptions['preparePdfPages']>>>,
      runInSlot: async (run) => run(),
      maxPages: () => 5,
    }

    await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [pdfEngine], { ocrOptions, timeoutMs: 20 }))
    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(processImageBuffer).toHaveBeenCalledTimes(1)
    expect(liveExtractions(fake)[0]).toEqual(
      expect.objectContaining({ status: 'failed', failureReason: '[internal] document structure extraction timed out' }),
    )
  })

  it('aborts without writing when the attachment is deleted mid-job', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain' })
    const filePath = await writeFile('rules-deleted.txt', 'rules deleted mid job')
    const engine = fakeEngine('text', 1, async () => {
      fake.table(Attachment).splice(0)
      return textResult('1. Scope\n\nThis rulebook applies to everyone.')
    }, (mimeType) => mimeType === 'text/plain')

    const outcome = await runDocumentStructureExtraction(job, buildDeps(fake, filePath, [engine]))

    expect(outcome).toEqual({ kind: 'aborted' })
    expect(fake.table(AttachmentDocumentExtraction)).toHaveLength(0)
    expect(fake.table(AttachmentDocumentSection)).toHaveLength(0)
  })

  it('never processes an attachment from another tenant', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain', tenantId: TENANT_B, organizationId: ORG_B })
    const filePath = await writeFile('rules-other.txt', 'rules other')
    const deps = buildDeps(fake, filePath, [textEngine()])

    const outcome = await runDocumentStructureExtraction(job, deps)

    expect(outcome).toEqual({ kind: 'not_found' })
    expect(fake.table(AttachmentDocumentExtraction)).toHaveLength(0)
    expect(deps.resolveForPartition).not.toHaveBeenCalled()
  })

  it('refuses a partial-null scope pair', async () => {
    const fake = createFakeEm()
    seed(fake, { fileName: 'rules.txt', mimeType: 'text/plain' })
    const filePath = await writeFile('rules-partial-null.txt', 'rules partial null')

    await expect(
      runDocumentStructureExtraction(
        { attachmentId: ATTACHMENT_ID, tenantId: TENANT_A, organizationId: null },
        buildDeps(fake, filePath, [textEngine()]),
      ),
    ).rejects.toThrow('scope invariant')
  })
})

describe('enqueueDocumentStructureExtraction', () => {
  it('enqueues a validated payload on the registered queue', async () => {
    const enqueue = jest.fn(async () => 'job-1')
    const container = {
      hasRegistration: (name: string) => name === DOCUMENT_STRUCTURE_QUEUE_DI_KEY,
      resolve: <T,>() => ({ enqueue }) as unknown as T,
    }

    const jobId = await enqueueDocumentStructureExtraction(container, { ...job, force: true })

    expect(jobId).toBe('job-1')
    expect(enqueue).toHaveBeenCalledWith({ ...job, force: true })
  })

  it('rejects a partial-null scope before enqueueing', async () => {
    const enqueue = jest.fn(async () => 'job-1')
    const container = {
      hasRegistration: () => true,
      resolve: <T,>() => ({ enqueue }) as unknown as T,
    }

    await expect(
      enqueueDocumentStructureExtraction(container, { attachmentId: ATTACHMENT_ID, tenantId: null, organizationId: ORG_A }),
    ).rejects.toThrow('scope invariant')
    expect(enqueue).not.toHaveBeenCalled()
  })
})
