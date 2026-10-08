/**
 * Runner tamper-resistance helpers (R-3 mitigation).
 *
 * The public submission endpoint re-runs the evaluator against the
 * `(answers, hidden)` payload posted by the client and asserts the claimed
 * `endingKey` is the one the evaluator actually reaches. If the respondent
 * tampered with the request (e.g. claiming the "qualified" ending while
 * sending answers that don't trigger it), this returns `false` and the
 * route rejects the submission with 422.
 *
 * Pure — no I/O, no DI. Suitable for unit testing.
 */

import { evaluateFormLogic } from '../services/form-logic-evaluator'
import { OM_ROOT_KEYWORDS } from '../schema/jsonschema-extensions'

export type TamperCheckInput = {
  schema: Record<string, unknown>
  answers: Record<string, unknown>
  hidden: Record<string, unknown>
  claimedEndingKey: string | null
  locale: string
}

export type TamperCheckResult = {
  ok: boolean
  reason?: string
  reachedEndingKey?: string | null
}

/**
 * Validates that `claimedEndingKey` matches the ending the evaluator would
 * reach by walking from the first page through every jump rule.
 *
 * Empty/non-ending claim → the runner exited via "Submit" (no ending), which
 * is valid iff the evaluator never routes to an ending in any reachable
 * branch. (For "no ending claimed", we accept any non-ending outcome.)
 */
export function checkSubmissionTamper(input: TamperCheckInput): TamperCheckResult {
  const sections = readSections(input.schema)
  const pageSections = sections.filter((entry) => entry.kind === 'page' || entry.kind === undefined)
  const endingSections = sections.filter((entry) => entry.kind === 'ending')
  const endingKeys = new Set(endingSections.map((entry) => entry.key))
  if (input.claimedEndingKey && !endingKeys.has(input.claimedEndingKey)) {
    return { ok: false, reason: 'unknown_ending', reachedEndingKey: null }
  }

  const state = evaluateFormLogic(input.schema, {
    answers: input.answers,
    hidden: input.hidden,
    locale: input.locale,
  })

  let reachedEnding: string | null = null
  const visitedPages = new Set<string>()
  let cursorIndex = 0
  let safety = 0
  while (cursorIndex < pageSections.length) {
    if (safety++ > pageSections.length + 1) break
    const currentPage = pageSections[cursorIndex]
    if (visitedPages.has(currentPage.key)) {
      cursorIndex += 1
      continue
    }
    visitedPages.add(currentPage.key)
    const target = state.nextTarget(currentPage.key)
    if (target.type === 'ending') {
      reachedEnding = target.endingKey
      break
    }
    if (target.type === 'submit') {
      break
    }
    if (target.type === 'page') {
      const nextIndex = pageSections.findIndex((entry) => entry.key === target.pageKey)
      if (nextIndex >= 0) {
        cursorIndex = nextIndex
        continue
      }
    }
    cursorIndex += 1
  }

  if (input.claimedEndingKey !== reachedEnding) {
    return { ok: false, reason: 'ending_mismatch', reachedEndingKey: reachedEnding }
  }
  return { ok: true, reachedEndingKey: reachedEnding }
}

function readSections(schema: Record<string, unknown>): Array<{ key: string; kind?: string }> {
  const raw = schema[OM_ROOT_KEYWORDS.sections]
  if (!Array.isArray(raw)) return []
  const result: Array<{ key: string; kind?: string }> = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    if (typeof candidate.key !== 'string') continue
    const kind = typeof candidate.kind === 'string' ? candidate.kind : undefined
    result.push({ key: candidate.key, kind })
  }
  return result
}

/**
 * Picks URL-derived hidden field values out of a `URLSearchParams`, matching
 * declared names from `x-om-hidden-fields`. Unknown query keys are ignored;
 * declared names absent from the URL fall back to their declared default.
 */
export function pickHiddenFromUrl(
  schema: Record<string, unknown>,
  searchParams: URLSearchParams | Record<string, string>,
): Record<string, unknown> {
  const declarations = schema[OM_ROOT_KEYWORDS.hiddenFields]
  if (!Array.isArray(declarations)) return {}
  const result: Record<string, unknown> = {}
  const getter = searchParams instanceof URLSearchParams
    ? (name: string) => searchParams.get(name)
    : (name: string) => searchParams[name] ?? null
  for (const entry of declarations) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    if (typeof candidate.name !== 'string') continue
    const raw = getter(candidate.name)
    if (typeof raw === 'string' && raw.length > 0) {
      result[candidate.name] = raw
    } else if (typeof candidate.defaultValue === 'string') {
      result[candidate.name] = candidate.defaultValue
    }
  }
  return result
}
