/**
 * Workflows Module — Code view stage 2, the apply gate (spec section 2.2)
 *
 * ## The safety model, and why this one
 *
 * Stage 2 asks for *"two-way live sync"*. Taken literally — mutate the canvas
 * on every keystroke — it is unimplementable safely: deleting the `s` of
 * `"steps"` momentarily produces a document with no steps, and applying it
 * would delete every node, blow away the arrangement and push an undo entry
 * per character. So the two directions get the treatment each can actually
 * support:
 *
 * - **canvas → code is LIVE.** The panel re-renders from the canvas whenever
 *   the author has not started editing. This is the direction with no risk:
 *   the canvas is already the source of truth.
 * - **code → canvas is EXPLICIT.** The textarea is a local draft; the author
 *   presses Apply (or Cmd/Ctrl+Enter). Parsing and validation are still LIVE —
 *   squiggles, the issue list and the Apply button's enabled state all update
 *   as you type — so the feedback loop is immediate even though the commit is
 *   not.
 *
 * `evaluateCodeViewDraft` is that gate, and it is PURE so the rule is testable
 * without a canvas. It refuses in four escalating ways, each with a distinct
 * reason the UI can explain:
 *
 * 1. `unchanged` — nothing to apply.
 * 2. `parseError` — not JSON. Carries the line so the editor can point at it.
 * 3. `schemaError` — parses, but is not a workflow definition.
 * 4. `graphError` — a valid definition whose GRAPH is broken (no START, an
 *    unreachable step, a route to nowhere). Warnings do NOT block, exactly as
 *    they do not block a Save.
 *
 * Refusing on graph errors is the difference between this and a "just apply
 * whatever parses" design. A canvas holding a graph the engine would reject is
 * a canvas the author has to repair by hand, and they no longer have the JSON
 * they typed — the textarea now mirrors the broken result.
 */

import type { WorkflowValidationIssueSeverity } from './collect-validation-issues'

export type CodeViewApplyRefusal =
  | { ok: false; reason: 'unchanged' }
  | { ok: false; reason: 'parseError'; message: string; line: number | null }
  | { ok: false; reason: 'schemaError'; messages: string[] }
  | { ok: false; reason: 'graphError'; messages: string[] }

export type CodeViewApplyDecision<TDefinition> =
  | { ok: true; definition: TDefinition }
  | CodeViewApplyRefusal

export type CodeViewDraftInput<TDefinition> = {
  draftText: string
  /**
   * The JSON the canvas currently serializes to.
   *
   * OMIT it when there is no such text to compare against — an AI-generated
   * draft (spec section 9) is a document the author asked for, so "identical to
   * the canvas" is not a refusal, it is a coincidence. Every other refusal
   * still applies, which is the point: a generated definition passes the same
   * gate a pasted one does.
   */
  canvasText?: string
  parseDefinition: (parsed: unknown) => { ok: true; definition: TDefinition } | { ok: false; messages: string[] }
  /**
   * Graph-level validation of the parsed definition. Return only ERRORS —
   * warnings never block an apply, for the same reason they never block a save.
   */
  validateGraph: (definition: TDefinition) => string[]
}

/**
 * Extract the 1-based line number from a `JSON.parse` error message.
 *
 * Engines disagree on the wording, and some report only a character position,
 * so this is deliberately best-effort: a missing line means "no gutter marker",
 * never a marker on the wrong line.
 */
export function parseErrorLine(message: string, text: string): number | null {
  const lineMatch = /line (\d+)/i.exec(message)
  if (lineMatch) {
    const parsed = Number.parseInt(lineMatch[1], 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  const positionMatch = /position (\d+)/i.exec(message)
  if (positionMatch) {
    const offset = Number.parseInt(positionMatch[1], 10)
    if (!Number.isFinite(offset) || offset < 0) return null
    let line = 1
    for (let index = 0; index < Math.min(offset, text.length); index += 1) {
      if (text[index] === '\n') line += 1
    }
    return line
  }
  return null
}

export function evaluateCodeViewDraft<TDefinition>(
  input: CodeViewDraftInput<TDefinition>,
): CodeViewApplyDecision<TDefinition> {
  const { draftText, canvasText, parseDefinition, validateGraph } = input

  if (canvasText !== undefined && draftText === canvasText) {
    return { ok: false, reason: 'unchanged' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(draftText)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'parseError', message, line: parseErrorLine(message, draftText) }
  }

  const definitionResult = parseDefinition(parsed)
  if (!definitionResult.ok) {
    return { ok: false, reason: 'schemaError', messages: definitionResult.messages }
  }

  const graphErrors = validateGraph(definitionResult.definition)
  if (graphErrors.length > 0) {
    return { ok: false, reason: 'graphError', messages: graphErrors }
  }

  return { ok: true, definition: definitionResult.definition }
}

export type CodeViewDraftStatus = {
  dirty: boolean
  canApply: boolean
  /** Line the editor should mark as the parse failure, when there is one. */
  parseErrorLine: number | null
  parseErrorMessage: string | null
  blockingMessages: string[]
  blockingSeverity: WorkflowValidationIssueSeverity | null
}

export function describeCodeViewDraft<TDefinition>(
  decision: CodeViewApplyDecision<TDefinition>,
): CodeViewDraftStatus {
  if (decision.ok) {
    return {
      dirty: true,
      canApply: true,
      parseErrorLine: null,
      parseErrorMessage: null,
      blockingMessages: [],
      blockingSeverity: null,
    }
  }
  if (decision.reason === 'unchanged') {
    return {
      dirty: false,
      canApply: false,
      parseErrorLine: null,
      parseErrorMessage: null,
      blockingMessages: [],
      blockingSeverity: null,
    }
  }
  if (decision.reason === 'parseError') {
    return {
      dirty: true,
      canApply: false,
      parseErrorLine: decision.line,
      parseErrorMessage: decision.message,
      blockingMessages: [decision.message],
      blockingSeverity: 'error',
    }
  }
  return {
    dirty: true,
    canApply: false,
    parseErrorLine: null,
    parseErrorMessage: null,
    blockingMessages: decision.messages,
    blockingSeverity: 'error',
  }
}
