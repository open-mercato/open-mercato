import { expect, type APIRequestContext } from '@playwright/test'
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { uploadAttachmentFixture } from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'

export const STRUCTURE_TEST_TIMEOUT_MS = 180_000
export const PAST_PERFORMANCE_PHRASE = 'Past performance figures must carry a prominent risk warning'

const STRUCTURE_POLL_TIMEOUT_MS = 120_000
const STRUCTURE_POLL_INTERVAL_MS = 1_000
const TERMINAL_STATUSES = new Set(['completed', 'partial', 'skipped', 'failed'])
const FALLBACK_PARTITION_CODE = 'privateAttachments'
const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const LEFT_MARGIN = 72
const BODY_SIZE = 11
const BODY_LEADING = 13.5

export type StructureExtraction = {
  id: string
  status: string
  engine: string
  pageCount: number | null
  sectionCount: number | null
  skipReason: string | null
}

export type StructureOutlineNode = {
  id: string
  parentId: string | null
  kind: string
  numberLabel: string | null
  heading: string | null
  pageStart: number | null
  pageEnd: number | null
  anchorKey: string
  childCount: number
}

export type StructureBody = {
  attachmentId: string
  extraction: StructureExtraction | null
  outline: StructureOutlineNode[]
}

export type StructureSection = {
  id: string
  parentId: string | null
  ordinal: number
  kind: string
  numberLabel: string | null
  heading: string | null
  headingPath: string[]
  text?: string
  textTruncated: boolean
  pageStart: number | null
  pageEnd: number | null
  charStart: number
  charEnd: number
  anchorKey: string
  locator: string
  citation: string
}

export type SectionsBody = {
  extractionId: string | null
  items: StructureSection[]
  nextCursor: number | null
}

export type StructurePartition = {
  partitionCode: string
  partitionId: string | null
  autoExtract: boolean
}

export function structurePath(attachmentId: string, suffix = ''): string {
  return `/api/attachments/structure/${encodeURIComponent(attachmentId)}${suffix}`
}

function drawBody(page: PDFPage, font: PDFFont, lines: readonly string[], startY: number) {
  let cursor = startY
  for (const line of lines) {
    page.drawText(line, { x: LEFT_MARGIN, y: cursor, size: BODY_SIZE, font })
    cursor -= BODY_LEADING
  }
}

export async function buildRulebookPdf(): Promise<Buffer> {
  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)

  const first = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  first.drawText('Chapter 1 General Provisions', { x: LEFT_MARGIN, y: 700, size: 18, font: bold })
  first.drawText('1.1 Scope', { x: LEFT_MARGIN, y: 664, size: 13, font: bold })
  drawBody(first, regular, [
    'These rules apply to every financial promotion that a firm',
    'communicates or approves for communication to retail clients.',
  ], 644)

  const second = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  second.drawText('Chapter 8 Financial Promotions', { x: LEFT_MARGIN, y: 700, size: 18, font: bold })
  second.drawText('8.1 Fair presentation', { x: LEFT_MARGIN, y: 664, size: 13, font: bold })
  drawBody(second, regular, [
    'A financial promotion must be fair, clear and not misleading',
    'and it must present benefits together with relevant risks.',
  ], 644)

  const third = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  third.drawText('8.12 Past performance', { x: LEFT_MARGIN, y: 700, size: 13, font: bold })
  drawBody(third, regular, [
    `${PAST_PERFORMANCE_PHRASE}`,
    'stating that past performance is not a reliable indicator of',
    'future results and covering at least the preceding five years.',
  ], 680)
  third.drawText('8.13 Simulated performance', { x: LEFT_MARGIN, y: 600, size: 13, font: bold })
  drawBody(third, regular, [
    'Simulated past performance must relate to an investment with',
    'the same underlying strategy as the promoted investment.',
  ], 580)

  return Buffer.from(await document.save())
}

export function buildCfrExcerptText(): string {
  return [
    'Part 230 General Rules and Regulations',
    'This part sets out the general rules that apply to registered offerings.',
    '§ 230.100 Definitions',
    'For the purposes of this part the terms below have the meanings given to them.',
    '§ 230.101 Scope of exemption',
    'The exemption applies only to offerings that meet every condition in this section.',
    '§ 230.102 Filing requirements',
    'An issuer must file the required notice within fifteen days after the first sale.',
  ].join('\n\n')
}

export async function prepareStructurePartition(
  request: APIRequestContext,
  token: string,
  label: string,
): Promise<StructurePartition> {
  const partitionCode = `qa_struct_${label}_${Date.now()}`
  const response = await apiRequest(request, 'POST', '/api/attachments/partitions', {
    token,
    data: {
      code: partitionCode,
      title: `QA structure ${label}`,
      isPublic: false,
      requiresOcr: false,
      extractDocumentStructure: true,
    },
  })
  if (response.status() === 403) {
    return { partitionCode: FALLBACK_PARTITION_CODE, partitionId: null, autoExtract: false }
  }
  expect(response.status(), 'POST /api/attachments/partitions should return 201').toBe(201)
  const body = await readJsonSafe<{ item?: { id?: string } }>(response)
  return { partitionCode, partitionId: body?.item?.id ?? null, autoExtract: true }
}

export async function uploadStructureDocument(
  request: APIRequestContext,
  token: string,
  partition: StructurePartition,
  file: { fileName: string; mimeType: string; buffer: Buffer },
): Promise<string> {
  const uploaded = await uploadAttachmentFixture(request, token, {
    entityId: 'attachments:library',
    recordId: `qa-structure-${Date.now()}`,
    fileName: file.fileName,
    mimeType: file.mimeType,
    buffer: file.buffer,
    partitionCode: partition.partitionCode,
  })
  return uploaded.id
}

export async function readStructure(
  request: APIRequestContext,
  token: string,
  attachmentId: string,
  query = '',
): Promise<{ status: number; body: StructureBody | null }> {
  const response = await apiRequest(request, 'GET', `${structurePath(attachmentId)}${query}`, { token })
  return { status: response.status(), body: await readJsonSafe<StructureBody>(response) }
}

export async function readSections(
  request: APIRequestContext,
  token: string,
  attachmentId: string,
  query = '',
): Promise<{ status: number; body: SectionsBody | null }> {
  const response = await apiRequest(request, 'GET', structurePath(attachmentId, `/sections${query}`), { token })
  return { status: response.status(), body: await readJsonSafe<SectionsBody>(response) }
}

export async function waitForStructure(
  request: APIRequestContext,
  token: string,
  attachmentId: string,
  options: { notExtractionId?: string } = {},
): Promise<StructureBody> {
  const deadline = Date.now() + STRUCTURE_POLL_TIMEOUT_MS
  let last: StructureBody | null = null
  while (Date.now() < deadline) {
    const { status, body } = await readStructure(request, token, attachmentId, '?maxDepth=8')
    expect(status, 'GET structure should return 200 while polling').toBe(200)
    last = body
    const extraction = body?.extraction ?? null
    if (
      extraction &&
      TERMINAL_STATUSES.has(extraction.status) &&
      (!options.notExtractionId || extraction.id !== options.notExtractionId)
    ) {
      return body as StructureBody
    }
    await new Promise((resolve) => setTimeout(resolve, STRUCTURE_POLL_INTERVAL_MS))
  }
  throw new Error(
    `[internal] document structure extraction did not finish within ${STRUCTURE_POLL_TIMEOUT_MS} ms (last status: ${last?.extraction?.status ?? 'none'})`,
  )
}

export async function extractAndWait(
  request: APIRequestContext,
  token: string,
  attachmentId: string,
  partition: StructurePartition,
): Promise<StructureBody> {
  if (!partition.autoExtract) {
    const response = await apiRequest(request, 'POST', structurePath(attachmentId), {
      token,
      data: { ocr: 'never' },
    })
    expect([200, 202], 'POST structure should queue or return the current extraction').toContain(response.status())
  }
  return waitForStructure(request, token, attachmentId)
}

export async function deletePartitionQuietly(
  request: APIRequestContext,
  token: string | null,
  partition: StructurePartition | null,
): Promise<void> {
  if (!token || !partition?.partitionId) return
  await apiRequest(
    request,
    'DELETE',
    `/api/attachments/partitions?id=${encodeURIComponent(partition.partitionId)}`,
    { token },
  ).catch(() => undefined)
}
