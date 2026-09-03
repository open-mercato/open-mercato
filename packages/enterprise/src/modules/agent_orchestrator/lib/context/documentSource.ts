import type { ContextProvenance } from '../../data/validators'
import type { ContextSourceHit } from './registry'
import type { DocumentExtraction, DocumentFact } from '../../data/validators'
import { formatDocumentLocator } from './documentIngest'

/**
 * Document context source (context overlay, Phase 3).
 *
 * Maps the typed facts of a `DocumentExtraction` into the resolver's
 * `ContextSourceHit` shape (`kind: 'document'`) so document-derived snippets pack
 * through the SAME routed/pruned/provenance seam as entity + retrieval sources.
 * Each hit is citable by construction — it carries the source attachment id
 * (`ref`/`sourceRef`) and a `page:N[#bbox]` locator, so the P2 grounding contract
 * (`retrieve()`) holds for document facts too.
 *
 * Low-confidence facts are EXCLUDABLE from routing: a fact below
 * `minConfidence` is dropped here (it never enters the candidate pool), so a
 * poisoned/uncertain extraction cannot drive a routing decision. Extracted text
 * is UNTRUSTED data — the `snippet` is the raw value, never an instruction.
 */

/** Default floor below which a document fact is excluded from routing. */
export const DEFAULT_DOCUMENT_MIN_CONFIDENCE = 0.5

export type DocumentSourceOptions = {
  /** Facts with confidence below this are excluded from routing (default 0.5). */
  minConfidence?: number
}

/** A stable factId for a document fact: `document:<attachmentId>#<field>@<locator>`. */
export function documentFactId(fact: DocumentFact): string {
  return `document:${fact.sourceRef}#${fact.field}@${formatDocumentLocator(fact.locator)}`
}

/**
 * Build the provenance stamp for a document fact. `sourceKind: 'document'`,
 * `sourceRef` = the attachment id, `locator` = `page:N[#bbox]` — the exact shape
 * `AgentContextBundle.sources` consumes for AI-Act lineage.
 */
export function documentProvenance(fact: DocumentFact): ContextProvenance {
  return {
    factId: documentFactId(fact),
    sourceKind: 'document',
    sourceRef: fact.sourceRef,
    locator: formatDocumentLocator(fact.locator),
  }
}

/** A document fact paired with the citable hit it maps to (keeps fact ↔ hit aligned). */
export type DocumentSourceCandidate = {
  fact: DocumentFact
  hit: ContextSourceHit
}

/**
 * Convert an extraction into citable `document` candidates, dropping any fact
 * below the confidence floor (excludable-from-routing). The fact's confidence
 * becomes the hit `score` so the packer ranks higher-confidence document facts
 * first, exactly like retrieval relevance. The fact is returned alongside its hit
 * so provenance stamping stays aligned with the surviving facts.
 */
export function documentExtractionToCandidates(
  extraction: DocumentExtraction,
  options: DocumentSourceOptions = {},
): DocumentSourceCandidate[] {
  const minConfidence = options.minConfidence ?? DEFAULT_DOCUMENT_MIN_CONFIDENCE
  const candidates: DocumentSourceCandidate[] = []
  for (const fact of extraction.facts) {
    if (fact.confidence < minConfidence) continue
    candidates.push({
      fact,
      hit: {
        ref: fact.sourceRef,
        locator: formatDocumentLocator(fact.locator),
        score: fact.confidence,
        record: {
          field: fact.field,
          value: fact.value,
          docType: extraction.docType,
          engine: extraction.engine,
          // The agent-visible snippet — UNTRUSTED data, never an instruction.
          snippet: `${fact.field}: ${fact.value}`,
        },
      },
    })
  }
  return candidates
}
