import { buildAnchorKey, formatSectionLocator, resolveSectionReference } from './locator'
import {
  DOCUMENT_STRUCTURE_NUMBER_LABEL_MAX_LENGTH,
  type DocumentBlock,
  type DocumentEngineResult,
  type DocumentOutlineEntry,
  type DocumentSectionKind,
  type DocumentSectionNode,
  type DocumentSectionSource,
  type DocumentStructureEngineName,
  type DocumentStructureExtractionResult,
} from './types'

const DEFAULT_MAX_SECTION_CHARS = 16_000
const DEFAULT_MAX_SECTIONS = 20_000
const SECTION_SEPARATOR = '\n\n'
const RUNNING_LINE_PAGE_RATIO = 0.6
const RUNNING_LINE_MAX_CHARS = 150
const RUNNING_LINE_Y_BAND = 10
const HEADING_MAX_CHARS = 120
const FONT_HEADING_MAX_CHARS = 200
const FONT_HEADING_MAX_LINES = 3
const FONT_HEADING_RATIO = 1.15
const CAPS_HEADING_MAX_CHARS = 100
const CAPS_HEADING_MIN_LETTERS = 3
const OUTLINE_LOOKAHEAD = 3

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD]/g
const HYPHENATED_LINE_BREAK = /(\p{L})-[ \t]*\n[ \t]*(\p{Ll})/gu
const PAGE_NUMBER_LINE = /^(?:page\s+)?[-–—]?\s*\d{1,4}\s*[-–—]?(?:\s*(?:of|\/)\s*\d{1,4})?$/i
const KEYWORD_NUMBERING =
  /^(Part|PART|Title|TITLE|Chapter|CHAPTER|Section|SECTION|Article|ARTICLE|Art\.|ART\.|Annex|ANNEX|Appendix|APPENDIX|Schedule|SCHEDULE)\s+(\d{1,4}[A-Za-z]?|[IVXLC]+[A-Z]?|[A-Z])(?=$|[\s.:–—-])(.*)$/
const SECTION_SIGN_NUMBERING = /^(§+)\s*(\d{1,4}(?:\.\d{1,4}){0,5}[a-z]?)\.?(?=$|\s)(.*)$/
const DECIMAL_NUMBERING = /^(\d{1,3}(?:\.\d{1,3}){0,5})(\.?)(?=$|\s)(.*)$/
const PAREN_NUMBER_NUMBERING = /^\((\d{1,3})\)\s+(\S.*)$/
const POINT_NUMBERING = /^\(?([a-z]{1,5})\)\s+(\S.*)$/
const ROMAN_HEADING_NUMBERING = /^([IVXLC]{1,7})\.\s+(\S.*)$/
const ALPHA_HEADING_NUMBERING = /^([A-Z])\.\s+(\S.*)$/
const LOWER_ROMAN = /^(?:x{0,3})(?:ix|iv|v?i{0,3})$/
const UPPER_ROMAN = /^(?:C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/
const AMBIGUOUS_ROMAN_LETTERS = new Set(['i', 'v', 'x', 'I', 'V', 'X', 'L', 'C'])
const TERMINAL_PUNCTUATION = /[.;:,]$/
const LEADING_SEPARATORS = /^[\s.:–—-]+/
const STARTS_LOWERCASE = /^\p{Ll}/u

type HeadingFamily =
  | 'explicit'
  | 'keyword'
  | 'romanHeading'
  | 'font'
  | 'caps'
  | 'alphaHeading'
  | 'decimal'
  | 'bold'
  | 'parenNumber'
  | 'letter'
  | 'romanList'
  | 'list'
  | 'body'

const FAMILY_TIERS: Record<HeadingFamily, number> = {
  explicit: 0,
  keyword: 1,
  romanHeading: 2,
  font: 3,
  caps: 4,
  alphaHeading: 5,
  decimal: 6,
  bold: 7,
  parenNumber: 8,
  letter: 9,
  romanList: 10,
  list: 11,
  body: 12,
}

const LIST_FAMILIES = new Set<HeadingFamily>(['parenNumber', 'letter', 'romanList', 'list'])

type KeywordDefinition = { canonical: string; kind: DocumentSectionKind; depth: number }

const KEYWORDS: Record<string, KeywordDefinition> = {
  part: { canonical: 'Part', kind: 'part', depth: 1 },
  title: { canonical: 'Title', kind: 'part', depth: 1 },
  annex: { canonical: 'Annex', kind: 'annex', depth: 1 },
  appendix: { canonical: 'Appendix', kind: 'annex', depth: 1 },
  schedule: { canonical: 'Schedule', kind: 'annex', depth: 1 },
  chapter: { canonical: 'Chapter', kind: 'chapter', depth: 2 },
  section: { canonical: 'Section', kind: 'section', depth: 3 },
  article: { canonical: 'Article', kind: 'article', depth: 3 },
  'art.': { canonical: 'Article', kind: 'article', depth: 3 },
}

export type StructureDocumentOptions = {
  engine: DocumentStructureEngineName
  engineVersion: number
  title?: string | null
  maxSectionChars?: number
  maxSections?: number
}

type CleanBlock = {
  text: string
  pageStart: number | null
  pageEnd: number | null
  source: DocumentSectionSource
  fontSize: number | null
  bold: boolean
  y: number | null
  headingLevel: number | null
  listDepth: number | null
  isTable: boolean
}

type TextUnit = {
  text: string
  pageStart: number | null
  pageEnd: number | null
}

type DraftNode = {
  kind: DocumentSectionKind
  numberLabel: string | null
  heading: string | null
  units: TextUnit[]
  source: DocumentSectionSource
  children: DraftNode[]
  family: HeadingFamily | null
  familyDepth: number
  numberDepth: number
  fixedPage: number | null
}

type NumberingMatch = {
  family: HeadingFamily
  familyDepth: number
  numberDepth: number
  label: string
  kind: DocumentSectionKind | null
  remainder: string
}

type HeadingCandidate = {
  family: HeadingFamily
  familyDepth: number
  numberDepth: number
  label: string | null
  kind: DocumentSectionKind | null
  heading: string | null
}

type NumberingState = {
  previousLetter: string | null
  previousCapital: string | null
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.floor(parsed)
}

export function resolveMaxSectionChars(): number {
  return readPositiveIntEnv('OM_ATTACHMENT_STRUCTURE_MAX_SECTION_CHARS', DEFAULT_MAX_SECTION_CHARS)
}

export function resolveMaxSections(): number {
  return readPositiveIntEnv('OM_ATTACHMENT_STRUCTURE_MAX_SECTIONS', DEFAULT_MAX_SECTIONS)
}

export function cleanBlockText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .normalize('NFKC')
    .replace(CONTROL_CHARACTERS, '')
    .replace(HYPHENATED_LINE_BREAK, '$1$2')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

function toCleanBlock(block: DocumentBlock): CleanBlock {
  return {
    text: cleanBlockText(block.text),
    pageStart: block.page,
    pageEnd: block.page,
    source: block.source,
    fontSize: block.fontSize ?? null,
    bold: block.bold === true,
    y: block.y ?? null,
    headingLevel: block.headingLevel ?? null,
    listDepth: block.listDepth ?? null,
    isTable: block.isTable === true,
  }
}

function runningLineSignature(text: string): string {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
}

function removeRunningHeadersAndFooters(blocks: CleanBlock[]): CleanBlock[] {
  const pages = new Set<number>()
  for (const block of blocks) if (block.pageStart !== null) pages.add(block.pageStart)
  if (pages.size < 2) return blocks
  const firstIndexByPage = new Map<number, number>()
  const lastIndexByPage = new Map<number, number>()
  blocks.forEach((block, index) => {
    if (block.pageStart === null) return
    if (!firstIndexByPage.has(block.pageStart)) firstIndexByPage.set(block.pageStart, index)
    lastIndexByPage.set(block.pageStart, index)
  })
  const keyFor = (block: CleanBlock, index: number): string | null => {
    if (block.pageStart === null || block.text.length > RUNNING_LINE_MAX_CHARS) return null
    const signature = runningLineSignature(block.text)
    if (block.y !== null) return `y:${Math.round(block.y / RUNNING_LINE_Y_BAND)}|${signature}`
    if (firstIndexByPage.get(block.pageStart) === index) return `top|${signature}`
    if (lastIndexByPage.get(block.pageStart) === index) return `bottom|${signature}`
    return null
  }
  const pagesByKey = new Map<string, Set<number>>()
  const keys = blocks.map((block, index) => {
    const key = keyFor(block, index)
    if (key !== null && block.pageStart !== null) {
      const keyPages = pagesByKey.get(key) ?? new Set<number>()
      keyPages.add(block.pageStart)
      pagesByKey.set(key, keyPages)
    }
    return key
  })
  const threshold = Math.max(2, Math.ceil(pages.size * RUNNING_LINE_PAGE_RATIO))
  return blocks.filter((_block, index) => {
    const key = keys[index]
    if (key === null) return true
    return (pagesByKey.get(key)?.size ?? 0) < threshold
  })
}

function isPlainBodyBlock(block: CleanBlock): boolean {
  return !block.isTable && block.headingLevel === null && block.listDepth === null
}

function joinHyphenatedBlocks(blocks: CleanBlock[]): CleanBlock[] {
  const result: CleanBlock[] = []
  for (const block of blocks) {
    const previous = result[result.length - 1]
    if (
      previous &&
      isPlainBodyBlock(previous) &&
      isPlainBodyBlock(block) &&
      /\p{L}-$/u.test(previous.text) &&
      STARTS_LOWERCASE.test(block.text) &&
      !POINT_NUMBERING.test(block.text)
    ) {
      result[result.length - 1] = {
        ...previous,
        text: `${previous.text.slice(0, -1)}${block.text}`,
        pageStart: previous.pageStart ?? block.pageStart,
        pageEnd: block.pageEnd ?? previous.pageEnd,
      }
      continue
    }
    result.push(block)
  }
  return result
}

function cleanDocumentBlocks(blocks: readonly DocumentBlock[]): CleanBlock[] {
  const cleaned = blocks
    .map(toCleanBlock)
    .filter((block) => block.text.length > 0)
    .filter((block) => block.pageStart === null || !PAGE_NUMBER_LINE.test(block.text))
  return joinHyphenatedBlocks(removeRunningHeadersAndFooters(cleaned))
}

function isHeadingLike(text: string): boolean {
  return text.length > 0 && text.length <= HEADING_MAX_CHARS && !TERMINAL_PUNCTUATION.test(text)
}

function isRomanToken(token: string, pattern: RegExp, previousLetter: string | null): boolean {
  if (!pattern.test(token)) return false
  if (token.length > 1) return true
  if (!AMBIGUOUS_ROMAN_LETTERS.has(token)) return false
  return previousLetter !== String.fromCharCode(token.charCodeAt(0) - 1)
}

function stripSeparators(value: string): string {
  return value.replace(LEADING_SEPARATORS, '').trim()
}

function matchKeyword(line: string): NumberingMatch | null {
  const match = KEYWORD_NUMBERING.exec(line)
  if (!match) return null
  const definition = KEYWORDS[match[1].toLowerCase()]
  if (!definition) return null
  const remainder = stripSeparators(match[3])
  if (STARTS_LOWERCASE.test(remainder)) return null
  return {
    family: 'keyword',
    familyDepth: definition.depth,
    numberDepth: 1,
    label: `${definition.canonical} ${match[2]}`,
    kind: definition.kind,
    remainder,
  }
}

function matchSectionSign(line: string): NumberingMatch | null {
  const match = SECTION_SIGN_NUMBERING.exec(line)
  if (!match) return null
  const depth = match[2].split('.').length
  return {
    family: 'decimal',
    familyDepth: depth,
    numberDepth: depth,
    label: `${match[1]}${match[2]}`,
    kind: 'section',
    remainder: stripSeparators(match[3]),
  }
}

function matchDecimal(line: string): NumberingMatch | null {
  const match = DECIMAL_NUMBERING.exec(line)
  if (!match) return null
  const hasTrailingDot = match[2] === '.'
  const remainder = match[3].trim()
  const depth = match[1].split('.').length
  if (!hasTrailingDot && STARTS_LOWERCASE.test(remainder)) return null
  if (!hasTrailingDot && depth === 1 && remainder.length === 0) return null
  return { family: 'decimal', familyDepth: depth, numberDepth: depth, label: match[1], kind: null, remainder }
}

function matchParenNumber(line: string): NumberingMatch | null {
  const match = PAREN_NUMBER_NUMBERING.exec(line)
  if (!match) return null
  return {
    family: 'parenNumber',
    familyDepth: 1,
    numberDepth: 1,
    label: `(${match[1]})`,
    kind: 'paragraph',
    remainder: match[2],
  }
}

function matchPoint(line: string, state: NumberingState): NumberingMatch | null {
  const match = POINT_NUMBERING.exec(line)
  if (!match) return null
  const token = match[1]
  const roman = isRomanToken(token, LOWER_ROMAN, state.previousLetter)
  if (!roman && token.length > 1) return null
  if (!roman) state.previousLetter = token
  return {
    family: roman ? 'romanList' : 'letter',
    familyDepth: 1,
    numberDepth: 1,
    label: `(${token})`,
    kind: 'list_item',
    remainder: match[2],
  }
}

function matchLetteredHeading(line: string, state: NumberingState): NumberingMatch | null {
  const romanMatch = ROMAN_HEADING_NUMBERING.exec(line)
  if (romanMatch && isRomanToken(romanMatch[1], UPPER_ROMAN, state.previousCapital)) {
    const remainder = romanMatch[2].trim()
    if (STARTS_LOWERCASE.test(remainder)) return null
    return { family: 'romanHeading', familyDepth: 1, numberDepth: 1, label: romanMatch[1], kind: 'part', remainder }
  }
  const alphaMatch = ALPHA_HEADING_NUMBERING.exec(line)
  if (!alphaMatch) return null
  const remainder = alphaMatch[2].trim()
  if (STARTS_LOWERCASE.test(remainder)) return null
  state.previousCapital = alphaMatch[1]
  return { family: 'alphaHeading', familyDepth: 1, numberDepth: 1, label: alphaMatch[1], kind: 'section', remainder }
}

export function normalizeNumberLabel(label: string): string {
  const normalized = label
    .normalize('NFKC')
    .replace(/^(§+)\s+/, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized.slice(0, DOCUMENT_STRUCTURE_NUMBER_LABEL_MAX_LENGTH)
}

function detectNumbering(line: string, state: NumberingState): NumberingMatch | null {
  return (
    matchKeyword(line) ??
    matchSectionSign(line) ??
    matchDecimal(line) ??
    matchParenNumber(line) ??
    matchPoint(line, state) ??
    matchLetteredHeading(line, state)
  )
}

function deriveNumberedHeading(numbering: NumberingMatch, lines: readonly string[]): string | null {
  if (LIST_FAMILIES.has(numbering.family)) return null
  if (numbering.remainder.length > 0) return isHeadingLike(numbering.remainder) ? numbering.remainder : null
  const nextLine = lines[1]
  return nextLine !== undefined && isHeadingLike(nextLine) ? nextLine : null
}

function normalizeForOutline(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

function createOutlineMatcher(outline: readonly DocumentOutlineEntry[]) {
  const titles = outline.map((entry) => normalizeForOutline(entry.title))
  let pointer = 0
  return (block: CleanBlock): number | null => {
    const text = normalizeForOutline(block.text)
    const limit = Math.min(outline.length, pointer + OUTLINE_LOOKAHEAD)
    for (let index = pointer; index < limit; index += 1) {
      const entry = outline[index]
      const title = titles[index]
      if (title.length === 0 || !text.startsWith(title)) continue
      if (entry.page !== null && block.pageStart !== null && entry.page !== block.pageStart) continue
      pointer = index + 1
      return entry.depth
    }
    return null
  }
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function roundFontSize(size: number): number {
  return Math.round(size * 2) / 2
}

function isFontHeading(block: CleanBlock, medianFontSize: number | null): boolean {
  if (block.fontSize === null || medianFontSize === null) return false
  if (block.text.length > FONT_HEADING_MAX_CHARS) return false
  if (block.text.split('\n').length > FONT_HEADING_MAX_LINES) return false
  return block.fontSize >= medianFontSize * FONT_HEADING_RATIO
}

function isBoldHeading(block: CleanBlock): boolean {
  return block.bold && !block.text.includes('\n') && isHeadingLike(block.text)
}

function isCapsHeading(block: CleanBlock): boolean {
  if (block.text.includes('\n') || block.text.length > CAPS_HEADING_MAX_CHARS) return false
  const letters = block.text.match(/\p{L}/gu) ?? []
  return letters.length >= CAPS_HEADING_MIN_LETTERS && !/\p{Ll}/u.test(block.text) && !/[.;,]$/.test(block.text)
}

function singleLine(text: string): string {
  return text.replace(/\n/g, ' ')
}

type HeadingDetector = (block: CleanBlock) => HeadingCandidate | null

function createHeadingDetector(blocks: readonly CleanBlock[], outline: readonly DocumentOutlineEntry[]): HeadingDetector {
  const matchOutline = createOutlineMatcher(outline)
  const medianFontSize = medianOf(
    blocks.map((block) => block.fontSize).filter((size): size is number => size !== null),
  )
  const fontRanks = [
    ...new Set(
      blocks
        .filter((block) => isFontHeading(block, medianFontSize))
        .map((block) => roundFontSize(block.fontSize ?? 0)),
    ),
  ].sort((left, right) => right - left)
  const state: NumberingState = { previousLetter: null, previousCapital: null }

  return (block) => {
    if (block.isTable || block.listDepth !== null) return null
    const lines = block.text.split('\n')
    const explicitLevel = matchOutline(block) ?? block.headingLevel
    const numbering = detectNumbering(lines[0], state)
    if (explicitLevel !== null) {
      return {
        family: 'explicit',
        familyDepth: explicitLevel,
        numberDepth: numbering?.numberDepth ?? 0,
        label: numbering ? normalizeNumberLabel(numbering.label) : null,
        kind: numbering?.kind ?? null,
        heading: numbering ? numbering.remainder || null : singleLine(block.text),
      }
    }
    if (numbering) {
      return {
        family: numbering.family,
        familyDepth: numbering.familyDepth,
        numberDepth: numbering.numberDepth,
        label: normalizeNumberLabel(numbering.label),
        kind: numbering.kind,
        heading: deriveNumberedHeading(numbering, lines),
      }
    }
    if (isFontHeading(block, medianFontSize)) {
      const rank = fontRanks.indexOf(roundFontSize(block.fontSize ?? 0)) + 1
      return { family: 'font', familyDepth: rank, numberDepth: 0, label: null, kind: null, heading: singleLine(block.text) }
    }
    if (isCapsHeading(block)) {
      return { family: 'caps', familyDepth: 1, numberDepth: 0, label: null, kind: 'section', heading: block.text }
    }
    if (isBoldHeading(block)) {
      return { family: 'bold', familyDepth: 1, numberDepth: 0, label: null, kind: 'section', heading: block.text }
    }
    return null
  }
}

function unitOf(block: CleanBlock): TextUnit {
  return { text: block.text, pageStart: block.pageStart, pageEnd: block.pageEnd }
}

function createDraft(input: Partial<DraftNode> & Pick<DraftNode, 'kind' | 'source'>): DraftNode {
  return {
    numberLabel: null,
    heading: null,
    units: [],
    children: [],
    family: null,
    familyDepth: 0,
    numberDepth: 0,
    fixedPage: null,
    ...input,
  }
}

function inferKind(node: DraftNode, candidate: HeadingCandidate, parent: DraftNode): DocumentSectionKind {
  if (candidate.kind) return candidate.kind
  if (candidate.label !== null && candidate.numberDepth > 0) {
    if (candidate.numberDepth > 1) return 'clause'
    if (parent.kind === 'article') return 'paragraph'
    if (['document', 'part', 'chapter', 'annex'].includes(parent.kind)) return 'section'
    return 'clause'
  }
  return node.familyDepth <= 1 && (node.family === 'explicit' || node.family === 'font') ? 'chapter' : 'section'
}

function buildDraftTree(
  blocks: readonly CleanBlock[],
  engineResult: DocumentEngineResult,
  title: string | null,
): DraftNode {
  const root = createDraft({ kind: 'document', source: blocks[0]?.source ?? 'text', heading: title })
  const stack: DraftNode[] = [root]
  const top = () => stack[stack.length - 1]
  const detectHeading = createHeadingDetector(blocks, engineResult.outline)
  const pendingUnreadable = [...new Set(engineResult.unreadablePages)].sort((left, right) => left - right)

  const attach = (node: DraftNode) => {
    const tier = FAMILY_TIERS[node.family ?? 'body']
    while (stack.length > 1) {
      const current = top()
      const currentFamily = current.family ?? 'body'
      const sameFamily = currentFamily === node.family
      if (FAMILY_TIERS[currentFamily] > tier || (sameFamily && current.familyDepth >= node.familyDepth)) {
        stack.pop()
        continue
      }
      break
    }
    top().children.push(node)
    stack.push(node)
  }

  const appendBody = (unit: TextUnit, source: DocumentSectionSource) => {
    const current = top()
    if (current.children.length === 0) {
      current.units.push(unit)
      return
    }
    const paragraph = createDraft({ kind: 'paragraph', source, family: 'body', units: [unit] })
    current.children.push(paragraph)
    stack.push(paragraph)
  }

  const appendLeaf = (node: DraftNode) => {
    while (stack.length > 1 && top().family === 'body') stack.pop()
    top().children.push(node)
  }

  const flushUnreadable = (beforePage: number | null) => {
    while (pendingUnreadable.length > 0 && (beforePage === null || pendingUnreadable[0] < beforePage)) {
      const page = pendingUnreadable.shift() ?? 0
      appendLeaf(createDraft({ kind: 'page_unreadable', source: 'ocr', fixedPage: page }))
    }
  }

  for (const block of blocks) {
    if (block.pageStart !== null) flushUnreadable(block.pageStart)
    const unit = unitOf(block)
    if (block.isTable) {
      appendLeaf(createDraft({ kind: 'table', source: block.source, units: [unit] }))
      continue
    }
    if (block.listDepth !== null) {
      const node = createDraft({ kind: 'list_item', source: block.source, family: 'list', familyDepth: block.listDepth, units: [unit] })
      attach(node)
      continue
    }
    const candidate = detectHeading(block)
    if (!candidate) {
      appendBody(unit, block.source)
      continue
    }
    const node = createDraft({
      kind: 'section',
      source: block.source,
      family: candidate.family,
      familyDepth: candidate.familyDepth,
      numberDepth: candidate.numberDepth,
      numberLabel: candidate.label,
      heading: candidate.heading,
      units: [unit],
    })
    attach(node)
    node.kind = inferKind(node, candidate, stack[stack.length - 2] ?? root)
  }
  flushUnreadable(null)
  return root
}

function packSegments(segments: readonly string[], separator: string, maxChars: number): string[] {
  const chunks: string[] = []
  let current = ''
  for (const segment of segments) {
    if (current.length === 0) {
      current = segment
      continue
    }
    if (current.length + separator.length + segment.length <= maxChars) {
      current = `${current}${separator}${segment}`
      continue
    }
    chunks.push(current)
    current = segment
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

export function splitOversizedText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const lines = text.split('\n')
  if (lines.length > 1) {
    return packSegments(lines.flatMap((line) => splitOversizedText(line, maxChars)), '\n', maxChars)
  }
  const words = text.split(' ').filter((word) => word.length > 0)
  if (words.length > 1) {
    return packSegments(words.flatMap((word) => splitOversizedText(word, maxChars)), ' ', maxChars)
  }
  const pieces: string[] = []
  for (let index = 0; index < text.length; index += maxChars) pieces.push(text.slice(index, index + maxChars))
  return pieces
}

function chunkUnits(units: readonly TextUnit[], maxChars: number): TextUnit[][] {
  const expanded = units.flatMap((unit) =>
    splitOversizedText(unit.text, maxChars).map((text) => ({ ...unit, text })),
  )
  const chunks: TextUnit[][] = []
  let current: TextUnit[] = []
  let currentLength = 0
  for (const unit of expanded) {
    const nextLength = current.length === 0 ? unit.text.length : currentLength + SECTION_SEPARATOR.length + unit.text.length
    if (current.length > 0 && nextLength > maxChars) {
      chunks.push(current)
      current = [unit]
      currentLength = unit.text.length
      continue
    }
    current.push(unit)
    currentLength = nextLength
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function splitLongSections(node: DraftNode, maxChars: number): void {
  for (const child of node.children) splitLongSections(child, maxChars)
  const textLength = node.units.reduce((total, unit) => total + unit.text.length, 0)
  const separators = Math.max(0, node.units.length - 1) * SECTION_SEPARATOR.length
  if (textLength + separators <= maxChars) return
  const [first, ...rest] = chunkUnits(node.units, maxChars)
  node.units = first ?? []
  const paragraphs = rest.map((units) =>
    createDraft({ kind: 'paragraph', source: node.source, family: 'body', units }),
  )
  node.children = [...paragraphs, ...node.children]
}

type FlatNode = {
  draft: DraftNode
  parentOrdinal: number | null
  depth: number
  headingPath: string[]
}

function flattenTree(root: DraftNode): FlatNode[] {
  const flat: FlatNode[] = []
  const visit = (draft: DraftNode, parentOrdinal: number | null, depth: number, parentPath: string[]) => {
    const pathPart = depth === 0 ? null : (draft.numberLabel ?? draft.heading)
    const headingPath = pathPart ? [...parentPath, pathPart] : parentPath
    const ordinal = flat.length
    flat.push({ draft, parentOrdinal, depth, headingPath })
    for (const child of draft.children) visit(child, ordinal, depth + 1, headingPath)
  }
  visit(root, null, 0, [])
  return flat
}

function pageRange(draft: DraftNode): { pageStart: number | null; pageEnd: number | null } {
  if (draft.fixedPage !== null) return { pageStart: draft.fixedPage, pageEnd: draft.fixedPage }
  const starts = draft.units.map((unit) => unit.pageStart).filter((page): page is number => page !== null)
  const ends = draft.units.map((unit) => unit.pageEnd ?? unit.pageStart).filter((page): page is number => page !== null)
  if (starts.length === 0 || ends.length === 0) return { pageStart: null, pageEnd: null }
  return { pageStart: Math.min(...starts), pageEnd: Math.max(...ends) }
}

export function formatStructuredSectionLocator(section: DocumentSectionNode): string {
  return formatSectionLocator({
    pageStart: section.pageStart,
    pageEnd: section.pageEnd,
    section: resolveSectionReference(section.numberLabel, section.headingPath),
    charStart: section.charStart,
    charEnd: section.charEnd,
  })
}

export function structureDocument(
  engineResult: DocumentEngineResult,
  options: StructureDocumentOptions,
): DocumentStructureExtractionResult {
  const maxSectionChars = options.maxSectionChars ?? resolveMaxSectionChars()
  const maxSections = options.maxSections ?? resolveMaxSections()
  const blocks = cleanDocumentBlocks(engineResult.blocks)
  const title = options.title ? cleanBlockText(options.title) || null : null
  const root = buildDraftTree(blocks, engineResult, title)
  splitLongSections(root, maxSectionChars)
  const flat = flattenTree(root)
  const kept = flat.slice(0, maxSections)
  const truncated = kept.length < flat.length

  const anchorCounts = new Map<string, number>()
  const textParts: string[] = []
  let cursor = 0
  const sections: DocumentSectionNode[] = kept.map((entry, ordinal) => {
    const { draft } = entry
    const text = draft.units.map((unit) => unit.text).join(SECTION_SEPARATOR)
    let charStart = cursor
    if (text.length > 0) {
      if (textParts.length > 0) {
        textParts.push(SECTION_SEPARATOR)
        cursor += SECTION_SEPARATOR.length
      }
      charStart = cursor
      textParts.push(text)
      cursor += text.length
    }
    const baseAnchor = buildAnchorKey({ numberLabel: draft.numberLabel, headingPath: entry.headingPath })
    const duplicateOrdinal = anchorCounts.get(baseAnchor) ?? 0
    anchorCounts.set(baseAnchor, duplicateOrdinal + 1)
    const anchorKey =
      duplicateOrdinal === 0
        ? baseAnchor
        : buildAnchorKey({ numberLabel: draft.numberLabel, headingPath: entry.headingPath, duplicateOrdinal })
    return {
      ordinal,
      depth: entry.depth,
      parentOrdinal: entry.parentOrdinal,
      kind: draft.kind,
      numberLabel: draft.numberLabel,
      heading: draft.heading,
      headingPath: entry.headingPath,
      text,
      ...pageRange(draft),
      charStart,
      charEnd: charStart + text.length,
      anchorKey,
      source: draft.source,
    }
  })
  const normalizedText = textParts.join('')
  const partial = truncated || engineResult.unreadablePages.length > 0

  return {
    engine: options.engine,
    engineVersion: options.engineVersion,
    status: partial ? 'partial' : 'completed',
    skipReason: null,
    pageCount: engineResult.pageCount,
    sectionCount: sections.length,
    charCount: normalizedText.length,
    ocrPageCount: engineResult.ocrPageCount,
    normalizedText,
    sections,
  }
}
