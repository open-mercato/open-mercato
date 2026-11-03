/**
 * Workflows Module — Code-view issue locations (spec section 2.2, stage 2)
 *
 * Stage 2 is *"two-way live sync with error squiggles that highlight the
 * corresponding node"*. `collectValidationIssues` already carries `nodeId` /
 * `edgeId` on every issue, so the missing half is purely positional: WHERE in
 * the JSON text does the step or transition with that id live.
 *
 * The scan is a minimal JSON tokenizer rather than a regex over
 * `"id": "<value>"`, because the author is editing free text: a step id can
 * appear inside a `{{context.*}}` template, inside a transition's
 * `fromStepId`, or inside a note's markdown, and a regex would happily point
 * the squiggle at any of them. Tracking the container path is the only way to
 * mean "the element of `steps` at index i".
 *
 * PURE: no ORM, no DI, no React.
 */

export type JsonLineRange = {
  /** 1-based, inclusive. */
  startLine: number
  /** 1-based, inclusive. */
  endLine: number
}

export type DefinitionJsonLocations = {
  steps: Map<string, JsonLineRange>
  transitions: Map<string, JsonLineRange>
}

type ArrayElementRange = { index: number } & JsonLineRange

/**
 * Line ranges of the elements of the top-level `steps` and `transitions`
 * arrays, by ARRAY INDEX. Ids are attached separately from the parsed document,
 * so a malformed id (missing, non-string, duplicated) cannot desynchronise the
 * scan.
 */
function scanTopLevelArrayElements(text: string): {
  steps: ArrayElementRange[]
  transitions: ArrayElementRange[]
} {
  const steps: ArrayElementRange[] = []
  const transitions: ArrayElementRange[] = []

  let line = 1
  let inString = false
  let escaped = false
  // Depth 1 is the document object. A tracked array's elements sit at depth 3.
  let depth = 0
  let pendingKey: string | null = null
  let currentStringStart = -1
  let trackedArray: 'steps' | 'transitions' | null = null
  let trackedArrayDepth = -1
  let elementIndex = 0
  let elementStartLine = -1
  let elementDepth = -1

  for (let position = 0; position < text.length; position += 1) {
    const char = text[position]

    if (char === '\n') {
      line += 1
      // A newline cannot appear inside a valid JSON string literal, so this
      // also self-heals if the author is mid-edit.
      inString = false
      escaped = false
      continue
    }

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
        const literal = text.slice(currentStringStart, position)
        // A string immediately followed by `:` is an object key.
        let lookahead = position + 1
        while (lookahead < text.length && /\s/.test(text[lookahead])) lookahead += 1
        if (text[lookahead] === ':') pendingKey = literal
      }
      continue
    }

    if (char === '"') {
      inString = true
      currentStringStart = position + 1
      continue
    }

    if (char === '[') {
      if (depth === 1 && (pendingKey === 'steps' || pendingKey === 'transitions')) {
        trackedArray = pendingKey
        trackedArrayDepth = depth
        elementIndex = 0
      }
      depth += 1
      pendingKey = null
      continue
    }

    if (char === '{') {
      if (trackedArray && depth === trackedArrayDepth + 1 && elementStartLine === -1) {
        elementStartLine = line
        elementDepth = depth
      }
      depth += 1
      pendingKey = null
      continue
    }

    if (char === '}') {
      depth -= 1
      if (trackedArray && elementStartLine !== -1 && depth === elementDepth) {
        const range: ArrayElementRange = { index: elementIndex, startLine: elementStartLine, endLine: line }
        if (trackedArray === 'steps') steps.push(range)
        else transitions.push(range)
        elementIndex += 1
        elementStartLine = -1
        elementDepth = -1
      }
      pendingKey = null
      continue
    }

    if (char === ']') {
      depth -= 1
      if (trackedArray && depth === trackedArrayDepth) {
        trackedArray = null
        trackedArrayDepth = -1
        elementStartLine = -1
        elementDepth = -1
      }
      pendingKey = null
      continue
    }
  }

  return { steps, transitions }
}

function readIdsAt(parsed: unknown, key: 'steps' | 'transitions', idField: string): Array<string | null> {
  if (!parsed || typeof parsed !== 'object') return []
  const collection = (parsed as Record<string, unknown>)[key]
  if (!Array.isArray(collection)) return []
  return collection.map((element) => {
    if (!element || typeof element !== 'object') return null
    const value = (element as Record<string, unknown>)[idField]
    return typeof value === 'string' && value.length > 0 ? value : null
  })
}

/**
 * Map every step id and transition id in `text` to its line range.
 *
 * `parsed` must be the result of `JSON.parse(text)`; the caller already has it
 * (it cannot decide whether to apply an edit without parsing) and passing it in
 * keeps this function from parsing the same text twice.
 */
export function locateDefinitionJsonEntities(text: string, parsed: unknown): DefinitionJsonLocations {
  const scanned = scanTopLevelArrayElements(text)
  const stepIds = readIdsAt(parsed, 'steps', 'stepId')
  const transitionIds = readIdsAt(parsed, 'transitions', 'transitionId')

  const steps = new Map<string, JsonLineRange>()
  for (const element of scanned.steps) {
    const id = stepIds[element.index]
    // First occurrence wins: a duplicated id is itself a validation error, and
    // pointing at the first one is more useful than at an arbitrary later one.
    if (id && !steps.has(id)) steps.set(id, { startLine: element.startLine, endLine: element.endLine })
  }

  const transitions = new Map<string, JsonLineRange>()
  for (const element of scanned.transitions) {
    const id = transitionIds[element.index]
    if (id && !transitions.has(id)) {
      transitions.set(id, { startLine: element.startLine, endLine: element.endLine })
    }
  }

  return { steps, transitions }
}

export type LocatedIssue = {
  issueId: string
  severity: 'error' | 'warning'
  line: number
}

/**
 * Project issues onto lines. An issue whose node/edge is not in the text (or
 * which names neither) is simply not located — the issue list still shows it,
 * it just gets no gutter marker rather than a marker on a wrong line.
 */
export function locateIssues(
  issues: Array<{ id: string; severity: 'error' | 'warning'; nodeId?: string; edgeId?: string }>,
  locations: DefinitionJsonLocations,
): LocatedIssue[] {
  const located: LocatedIssue[] = []
  for (const issue of issues) {
    const range = issue.nodeId
      ? locations.steps.get(issue.nodeId)
      : issue.edgeId
        ? locations.transitions.get(issue.edgeId)
        : undefined
    if (!range) continue
    located.push({ issueId: issue.id, severity: issue.severity, line: range.startLine })
  }
  return located
}

/**
 * Highest severity per line, so a line carrying both an error and a warning
 * paints as an error. Errors sort before warnings for the same reason.
 */
export function severityByLine(located: LocatedIssue[]): Map<number, 'error' | 'warning'> {
  const byLine = new Map<number, 'error' | 'warning'>()
  for (const issue of located) {
    const existing = byLine.get(issue.line)
    if (existing === 'error') continue
    byLine.set(issue.line, issue.severity)
  }
  return byLine
}
