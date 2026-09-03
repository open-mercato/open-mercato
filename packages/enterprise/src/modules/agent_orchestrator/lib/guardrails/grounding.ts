import {
  groundingClaimSchema,
  type CitableSource,
  type GroundingCitation,
  type GroundingClaim,
  type GuardrailSetBody,
  type GuardrailCheck,
  type GuardrailEvidence,
} from '../../data/validators'

/**
 * Deterministic grounding (cite-or-abstain) check (Wave 3, Phase 4 — GAP-09 hard
 * gate tier).
 *
 * For a FACTUAL capability, every material proposal claim must trace to a CITED
 * source from the run's `AgentContextBundle.sources` / `retrieve()` snippets. The
 * gate is structural and replayable (no model call): a factual claim with zero
 * resolvable citations is the cite-or-abstain failure, and a citation that
 * resolves to no surfaced citable source (or below the set's `minScore`) is a
 * dangling/irrelevant cite. Both map to `block`/`warn` per the capability's
 * versioned set (the sampled LLM faithfulness/NLI warn tier — GAP-09's semantic
 * layer — is deferred; this is the deterministic hard gate the spec schedules in
 * Phase 4).
 *
 * Evidence is POINTERS ONLY: the cited locators + which claim labels lacked
 * support. Raw claim payloads / span text NEVER enter evidence (the capability
 * authors a redaction-safe `claim` label; the citable text stays in the encrypted
 * artifact store).
 */

const GROUNDING_EVIDENCE_CLAIM_LIMIT = 10

/** Read a dot-path (e.g. `proposal.claims`) off the structured output. */
function readPath(output: unknown, path: string): unknown {
  let cursor: unknown = output
  for (const segment of path.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

/** A citable source resolves a citation when ref + locator match and score clears minScore. */
function citationResolves(
  citation: GroundingCitation,
  citableSources: CitableSource[],
  minScore: number,
): boolean {
  return citableSources.some(
    (source) =>
      source.sourceKind === citation.sourceKind &&
      source.sourceRef === citation.sourceRef &&
      source.locator === citation.locator &&
      source.score >= minScore,
  )
}

export type GroundingResult = {
  /** Claim labels with zero citations (cite-or-abstain failure). */
  uncitedClaims: string[]
  /** Claim labels carrying at least one citation that resolved to no citable source. */
  unresolvableClaims: string[]
  /** Distinct cited locators that DID resolve (the citation graph, pointers only). */
  resolvedPointers: string[]
}

/**
 * Evaluate the factual claims against the surfaced citable sources. Pure — no I/O,
 * no model call. Malformed claims are treated as uncited (fail-closed: a claim the
 * gate cannot read cannot be considered grounded).
 */
export function evaluateGrounding(
  claims: GroundingClaim[],
  citableSources: CitableSource[],
  minScore: number,
): GroundingResult {
  const uncitedClaims: string[] = []
  const unresolvableClaims: string[] = []
  const resolvedPointers = new Set<string>()

  for (const claim of claims) {
    if (claim.citations.length === 0) {
      uncitedClaims.push(claim.claim)
      continue
    }
    const resolved = claim.citations.filter((citation) =>
      citationResolves(citation, citableSources, minScore),
    )
    if (resolved.length === 0) {
      unresolvableClaims.push(claim.claim)
      continue
    }
    for (const citation of resolved) {
      resolvedPointers.add(`${citation.sourceKind}:${citation.sourceRef}@${citation.locator}`)
    }
  }

  return {
    uncitedClaims,
    unresolvableClaims,
    resolvedPointers: [...resolvedPointers],
  }
}

/** Build the redacted, POINTER-ONLY evidence for a grounding failure. */
function groundingEvidence(detail: string, evaluation: GroundingResult): GuardrailEvidence {
  const flaggedClaims = [...evaluation.uncitedClaims, ...evaluation.unresolvableClaims].slice(
    0,
    GROUNDING_EVIDENCE_CLAIM_LIMIT,
  )
  return {
    detail,
    pointers: evaluation.resolvedPointers,
    flaggedClaims,
    uncitedCount: evaluation.uncitedClaims.length,
    unresolvableCount: evaluation.unresolvableClaims.length,
  }
}

/**
 * Produce the single `grounding` check for a factual capability. The output's
 * factual claims (at the set's `claimsPath`) are validated and evaluated against
 * the surfaced citable sources; the worst failure mode maps to the set's declared
 * severity. `version` is the set's content-hash, stamped on the check for replay.
 */
export function checkGrounding(args: {
  output: unknown
  set: GuardrailSetBody
  citableSources: CitableSource[]
  version: string
}): GuardrailCheck {
  const { output, set, citableSources, version } = args

  const rawClaims = readPath(output, set.claimsPath)
  const parsed = groundingClaimSchema.array().safeParse(Array.isArray(rawClaims) ? rawClaims : [])
  const claims: GroundingClaim[] = parsed.success ? parsed.data : []

  // A factual capability that surfaced claims the gate could not parse fails
  // closed — an unreadable claim cannot be certified as grounded.
  const malformedClaims = !parsed.success && Array.isArray(rawClaims) && rawClaims.length > 0

  const evaluation = evaluateGrounding(claims, citableSources, set.minScore)

  const hasMissing = evaluation.uncitedClaims.length > 0 || malformedClaims
  const hasUnresolvable = evaluation.unresolvableClaims.length > 0

  // Worst severity across the two failure modes (block > warn > pass).
  let result: GuardrailCheck['result'] = 'pass'
  if ((hasMissing && set.missingCitation === 'block') || (hasUnresolvable && set.unresolvableCitation === 'block')) {
    result = 'block'
  } else if (
    (hasMissing && set.missingCitation === 'warn') ||
    (hasUnresolvable && set.unresolvableCitation === 'warn')
  ) {
    result = 'warn'
  }

  if (result === 'pass') {
    return { kind: 'grounding', result: 'pass', guardrailSetVersion: version }
  }

  const reasons: string[] = []
  if (hasMissing) reasons.push('uncited factual claim(s)')
  if (hasUnresolvable) reasons.push('unresolvable citation(s)')
  const detail = `grounding: ${reasons.join(', ')}`
  return {
    kind: 'grounding',
    result,
    guardrailSetVersion: version,
    evidence: groundingEvidence(detail, evaluation),
  }
}
