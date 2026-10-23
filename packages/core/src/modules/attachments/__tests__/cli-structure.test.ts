import { Attachment, AttachmentDocumentExtraction, AttachmentPartition } from '../data/entities'

type Row = Record<string, unknown>

const findWithDecryptionMock = jest.fn()
const enqueueMock = jest.fn()
const requestExtractionMock = jest.fn()
const getStructureMock = jest.fn()
const listSectionsMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../lib/documentStructure/queue', () => ({
  enqueueDocumentStructureExtraction: (...args: unknown[]) => enqueueMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => {
      if (key === 'em') return {}
      if (key === 'attachmentDocumentStructureService') {
        return {
          requestExtraction: requestExtractionMock,
          getStructure: getStructureMock,
          listSections: listSectionsMock,
        }
      }
      throw new Error(`[internal] unexpected DI key ${key}`)
    },
    hasRegistration: () => false,
  })),
}))

import attachmentsCli, {
  formatDocumentOutline,
  parseStructureBackfillArgs,
  parseStructureDumpArgs,
  parseStructureExtractArgs,
} from '../cli'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '22222222-2222-4222-8222-000000000000'
const ATTACHMENT = '33333333-3333-4333-8333-333333333333'

function attachmentId(index: number): string {
  return `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`
}

const structureCli = attachmentsCli.find((entry) => entry.command === 'structure')

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    const operators = expected as { $gt?: string; $in?: unknown[] }
    if (operators.$gt !== undefined) return typeof actual === 'string' && actual > operators.$gt
    if (operators.$in !== undefined) return operators.$in.includes(actual)
  }
  return actual === expected
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => matchesValue(row[key], value))
}

type Store = { partitions: Row[]; attachments: Row[]; extractions: Row[] }

function installStore(store: Store) {
  findWithDecryptionMock.mockImplementation(
    async (_em: unknown, entity: unknown, where: Row, options: { limit?: number } = {}) => {
      if (entity === AttachmentPartition) return store.partitions.filter((row) => matches(row, where))
      if (entity === AttachmentDocumentExtraction) return store.extractions.filter((row) => matches(row, where))
      if (entity === Attachment) {
        const rows = store.attachments
          .filter((row) => matches(row, where))
          .sort((left, right) => String(left.id).localeCompare(String(right.id)))
        return options.limit ? rows.slice(0, options.limit) : rows
      }
      return []
    },
  )
}

function buildAttachment(index: number, overrides: Row = {}): Row {
  return { id: attachmentId(index), tenantId: TENANT, organizationId: ORG, partitionCode: 'contracts', ...overrides }
}

describe('attachments structure CLI argument parsing', () => {
  it('parses extract arguments and requires tenant and organization', () => {
    expect(parseStructureExtractArgs(['--attachment', ATTACHMENT, '--tenant', TENANT, '--org', ORG, '--force', '--ocr', 'never'])).toEqual({
      ok: true,
      value: { attachmentId: ATTACHMENT, tenantId: TENANT, organizationId: ORG, force: true, ocr: 'never' },
    })
    expect(parseStructureExtractArgs(['--attachment', ATTACHMENT, '--tenant', TENANT])).toEqual({
      ok: false,
      error: 'Missing required --org',
    })
    const invalidOcr = parseStructureExtractArgs(['--attachment', ATTACHMENT, '--tenant', TENANT, '--org', ORG, '--ocr', 'always'])
    expect(invalidOcr.ok).toBe(false)
    const invalidId = parseStructureExtractArgs(['--attachment', 'nope', '--tenant', TENANT, '--org', ORG])
    expect(invalidId).toMatchObject({ ok: false, error: expect.stringContaining('Invalid --attachment') })
  })

  it('parses backfill arguments with optional scope narrowing', () => {
    expect(parseStructureBackfillArgs(['--tenant', TENANT, '--limit', '5', '--dry-run', '--partition', 'contracts'])).toEqual({
      ok: true,
      value: {
        tenantId: TENANT,
        organizationId: null,
        partitionCode: 'contracts',
        belowEngineVersion: null,
        limit: 5,
        dryRun: true,
      },
    })
    expect(parseStructureBackfillArgs(['--org', ORG])).toEqual({ ok: false, error: 'Missing required --tenant' })
    expect(parseStructureBackfillArgs(['--tenant', TENANT, '--limit', '0']).ok).toBe(false)
  })

  it('parses dump arguments with json alias and text opt-in', () => {
    expect(parseStructureDumpArgs(['--attachment', ATTACHMENT, '--tenant', TENANT, '--org', ORG, '--json'])).toMatchObject({
      ok: true,
      value: { format: 'json', withText: false },
    })
    expect(parseStructureDumpArgs(['--attachment', ATTACHMENT, '--tenant', TENANT, '--org', ORG])).toMatchObject({
      ok: true,
      value: { format: 'outline', withText: false },
    })
    expect(parseStructureDumpArgs(['--attachment', ATTACHMENT, '--tenant', TENANT, '--org', ORG, '--format', 'xml']).ok).toBe(false)
  })
})

describe('attachments structure CLI commands', () => {
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    process.exitCode = undefined
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    enqueueMock.mockResolvedValue('job-1')
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
    process.exitCode = undefined
  })

  it('exits with a usage error for unknown subcommands and invalid arguments', async () => {
    await structureCli?.run(['explode'])
    expect(process.exitCode).toBe(2)
    process.exitCode = undefined
    await structureCli?.run(['extract', '--attachment', ATTACHMENT])
    expect(process.exitCode).toBe(2)
    expect(requestExtractionMock).not.toHaveBeenCalled()
  })

  it('requests an on-demand extraction through the service scoped to tenant and organization', async () => {
    requestExtractionMock.mockResolvedValue({ extractionId: null, status: 'pending', enqueued: true, jobId: 'job-9' })
    await structureCli?.run(['extract', '--attachment', ATTACHMENT, '--tenant', TENANT, '--org', ORG, '--force'])
    expect(requestExtractionMock).toHaveBeenCalledWith({
      attachmentId: ATTACHMENT,
      scope: { tenantId: TENANT, organizationId: ORG },
      force: true,
    })
    expect(process.exitCode).toBeUndefined()
  })

  it('fails with exit code 1 when the attachment is outside the scope', async () => {
    requestExtractionMock.mockResolvedValue(null)
    await structureCli?.run(['extract', '--attachment', ATTACHMENT, '--tenant', TENANT, '--org', ORG])
    expect(process.exitCode).toBe(1)
  })

  it('lists backfill targets on dry run without enqueueing and respects scope and live extractions', async () => {
    installStore({
      partitions: [
        { code: 'contracts', extractDocumentStructure: true, tenantId: null, organizationId: null },
        { code: 'scans', extractDocumentStructure: false, tenantId: null, organizationId: null },
      ],
      attachments: [
        buildAttachment(1),
        buildAttachment(2),
        buildAttachment(3, { organizationId: OTHER_ORG }),
        buildAttachment(4, { partitionCode: 'scans' }),
        buildAttachment(5, { tenantId: '99999999-9999-4999-8999-999999999999' }),
        buildAttachment(6),
      ],
      extractions: [
        { attachmentId: attachmentId(2), status: 'completed', engineVersion: 1, deletedAt: null },
        { attachmentId: attachmentId(6), status: 'failed', engineVersion: 1, deletedAt: null },
      ],
    })
    await structureCli?.run(['backfill', '--tenant', TENANT, '--org', ORG, '--dry-run'])
    expect(enqueueMock).not.toHaveBeenCalled()
    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(output).toContain(attachmentId(1))
    expect(output).toContain(attachmentId(6))
    expect(output).not.toContain(attachmentId(2))
    expect(output).not.toContain(attachmentId(3))
    expect(output).not.toContain(attachmentId(4))
    expect(output).not.toContain(attachmentId(5))
    expect(output).toContain('Dry run: 2 attachment(s)')
  })

  it('enqueues backfill jobs page by page up to the limit', async () => {
    installStore({
      partitions: [{ code: 'contracts', extractDocumentStructure: true, tenantId: TENANT, organizationId: ORG }],
      attachments: Array.from({ length: 150 }, (_, index) => buildAttachment(index + 1)),
      extractions: [],
    })
    await structureCli?.run(['backfill', '--tenant', TENANT, '--limit', '120'])
    expect(enqueueMock).toHaveBeenCalledTimes(120)
    expect(enqueueMock).toHaveBeenCalledWith(expect.anything(), {
      attachmentId: attachmentId(1),
      tenantId: TENANT,
      organizationId: ORG,
      force: false,
    })
    const attachmentQueries = findWithDecryptionMock.mock.calls.filter((call) => call[1] === Attachment)
    expect(attachmentQueries.length).toBe(2)
  })

  it('re-enqueues outdated extractions with force when --below-engine-version is set', async () => {
    installStore({
      partitions: [{ code: 'contracts', extractDocumentStructure: true, tenantId: null, organizationId: null }],
      attachments: [buildAttachment(1), buildAttachment(2), buildAttachment(3)],
      extractions: [
        { attachmentId: attachmentId(1), status: 'completed', engineVersion: 1, deletedAt: null },
        { attachmentId: attachmentId(2), status: 'completed', engineVersion: 2, deletedAt: null },
      ],
    })
    await structureCli?.run(['backfill', '--tenant', TENANT, '--below-engine-version', '2'])
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ attachmentId: attachmentId(1), force: true }))
  })

  it('dumps the outline without section text unless requested', async () => {
    getStructureMock.mockResolvedValue({
      attachmentId: ATTACHMENT,
      extraction: {
        id: 'extraction-1',
        status: 'completed',
        engine: 'pdf_layout',
        engineVersion: 1,
        contentSha256: 'abc',
        pageCount: 3,
        sectionCount: 2,
        charCount: 100,
        ocrPageCount: 0,
        skipReason: null,
        completedAt: null,
      },
      outline: [
        { id: 'a', parentId: null, kind: 'chapter', numberLabel: '8', heading: 'Promotions', pageStart: 1, pageEnd: 2, anchorKey: 'k1', childCount: 1 },
        { id: 'b', parentId: 'a', kind: 'clause', numberLabel: '8.12', heading: 'Past performance', pageStart: 2, pageEnd: 2, anchorKey: 'k2', childCount: 0 },
      ],
    })
    await structureCli?.run(['dump', '--attachment', ATTACHMENT, '--tenant', TENANT, '--org', ORG])
    expect(listSectionsMock).not.toHaveBeenCalled()
    const output = logSpy.mock.calls.map((call) => String(call[0]))
    expect(output).toContain('8 Promotions [chapter] p. 1-2 anchor=k1')
    expect(output).toContain('  8.12 Past performance [clause] p. 2 anchor=k2')
  })

  it('indents nested outline nodes by parent depth', () => {
    expect(
      formatDocumentOutline([
        { id: 'a', parentId: null, kind: 'section', numberLabel: null, heading: null, pageStart: null, pageEnd: null, anchorKey: 'k', childCount: 1 },
        { id: 'b', parentId: 'a', kind: 'paragraph', numberLabel: '1', heading: null, pageStart: 4, pageEnd: 4, anchorKey: 'm', childCount: 0 },
      ]),
    ).toEqual(['(untitled) [section] anchor=k', '  1 [paragraph] p. 4 anchor=m'])
  })
})
