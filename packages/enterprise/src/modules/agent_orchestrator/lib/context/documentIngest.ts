import type { AwilixContainer } from 'awilix'
import {
  documentExtractionSchema,
  type DocumentExtraction,
  type DocumentFact,
  type DocumentLocator,
} from '../../data/validators'
import {
  resolveDefaultOcrProvider,
  type DocumentOcrBlock,
  type DocumentOcrProvider,
  type DocumentOcrScope,
} from './documentOcrProvider'

/**
 * Document ingest pipeline (context overlay, Phase 3).
 *
 * Elevates the existing hardcoded OpenAI vision-OCR path into a typed,
 * swappable-provider OCR → classification → field-extraction pipeline. Every
 * extracted fact carries PROVENANCE (source attachment id + page/region locator)
 * and a CONFIDENCE score so:
 *   - lineage flows fact → evidence for AI-Act contestability, and
 *   - low-confidence facts are excludable from routing (the resolver/packer drop
 *     them below a threshold).
 *
 * The OCR/layout stage is provider-agnostic (`DocumentOcrProvider`, swappable via
 * DI like every other seam in this module); the default provider wraps the
 * `attachments` OpenAI vision-OCR service. Extracted text is treated as UNTRUSTED
 * data, never instructions (Wave 3 injection isolation reads the same provenance).
 */

/** A document to ingest. `sourceRef` is the attachment id (FK id, NOT an ORM relation). */
export type DocumentIngestInput = {
  sourceRef: string
  buffer: Buffer
  mimeType: string
  fileName?: string
  scope: DocumentOcrScope
}

/**
 * A classifier maps a document's OCR text → a doc-type id (e.g. `invoice`,
 * `claim_form`). Pure + deterministic so ingest is testable without a model; an
 * LLM-object-mode classifier can replace it behind the same signature.
 */
export type DocumentClassifier = (text: string) => string

/**
 * A field extractor maps a document's OCR blocks → typed facts for one doc-type.
 * It binds each field to the page/region it came from and assigns a confidence.
 * Keeping it a pure function of `(blocks, docType)` lets the LLM object-mode
 * extractor (per-doc-type Zod schema) drop in later without touching the pipeline.
 */
export type DocumentFieldExtractor = (
  blocks: DocumentOcrBlock[],
  docType: string,
) => Array<{
  field: string
  value: string
  page: number
  region?: [number, number, number, number]
  confidence: number
}>

export type DocumentIngestOptions = {
  provider?: DocumentOcrProvider
  classifier?: DocumentClassifier
  extractor?: DocumentFieldExtractor
}

export interface DocumentIngestService {
  ingest(input: DocumentIngestInput): Promise<DocumentExtraction>
}

/**
 * Serialize a structured locator to the string the bundle's `locator` columns
 * carry: `page:<n>` or `page:<n>#<x0>,<y0>,<x1>,<y1>`. Round-trips through the
 * existing `ContextProvenance.locator` / `ContextRoutedSource.locator` string
 * shape with no schema change — the document fact lives in the same `sources`
 * provenance array as entity + retrieval facts.
 */
export function formatDocumentLocator(locator: DocumentLocator): string {
  if (locator.region) return `page:${locator.page}#${locator.region.join(',')}`
  return `page:${locator.page}`
}

/** Default classifier: a deterministic keyword heuristic over the OCR text. */
export const defaultDocumentClassifier: DocumentClassifier = (text) => {
  const haystack = text.toLowerCase()
  if (haystack.includes('invoice') || haystack.includes('amount due')) return 'invoice'
  if (haystack.includes('claim')) return 'claim_form'
  if (haystack.includes('policy')) return 'policy_document'
  return 'unknown'
}

/**
 * Default field extractor: pulls `Key: Value` lines from each OCR block and binds
 * each to its page (model-asserted geometry). Confidence is the OCR block's own
 * confidence when present, else a conservative default — enough to drive the
 * low-confidence exclusion seam. The LLM object-mode per-doc-type extractor
 * replaces this behind the same signature.
 */
export const defaultDocumentFieldExtractor: DocumentFieldExtractor = (blocks) => {
  const facts: ReturnType<DocumentFieldExtractor> = []
  const KEY_VALUE = /^\s*([A-Za-z][A-Za-z0-9 _-]{0,60})\s*[:#]\s*(.+?)\s*$/
  for (const block of blocks) {
    for (const line of block.text.split(/\r?\n/)) {
      const match = KEY_VALUE.exec(line)
      if (!match) continue
      const field = normalizeFieldName(match[1])
      const value = match[2].trim()
      if (!field || !value) continue
      facts.push({
        field,
        value,
        page: block.page,
        ...(block.region ? { region: block.region } : {}),
        confidence: 0.6,
      })
    }
  }
  return facts
}

function normalizeFieldName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export class DocumentIngestServiceImpl implements DocumentIngestService {
  private readonly provider: DocumentOcrProvider
  private readonly classify: DocumentClassifier
  private readonly extract: DocumentFieldExtractor

  constructor(container: AwilixContainer, options: DocumentIngestOptions = {}) {
    this.provider = options.provider ?? resolveDefaultOcrProvider(container)
    this.classify = options.classifier ?? defaultDocumentClassifier
    this.extract = options.extractor ?? defaultDocumentFieldExtractor
  }

  async ingest(input: DocumentIngestInput): Promise<DocumentExtraction> {
    const ocr = await this.provider.extract({
      buffer: input.buffer,
      mimeType: input.mimeType,
      ...(input.fileName ? { fileName: input.fileName } : {}),
      scope: input.scope,
    })
    const docType = this.classify(ocr.text)
    const blocks = ocr.pages.flatMap((page) => page.blocks)
    const raw = this.extract(blocks, docType)

    const facts: DocumentFact[] = raw.map((entry) => {
      const locator: DocumentLocator = {
        page: entry.page,
        ...(entry.region ? { region: entry.region } : {}),
      }
      // Combine the provider-level confidence (when present) with the per-fact
      // confidence so an IDP engine's geometry confidence narrows it.
      const providerConfidence = typeof ocr.confidence === 'number' ? ocr.confidence : 1
      const confidence = clamp01(entry.confidence * providerConfidence)
      return {
        field: entry.field,
        value: entry.value,
        sourceRef: input.sourceRef,
        locator,
        confidence,
      }
    })

    return documentExtractionSchema.parse({
      sourceRef: input.sourceRef,
      docType,
      engine: this.provider.id,
      facts,
    })
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}
