/**
 * The POST body, templated.
 *
 * A generic connector cannot know a provider's request shape, so the tenant
 * declares it as a JSON document with placeholders:
 *
 *   {
 *     "question":  "{{input.brief}}",
 *     "meta":      { "workflow": "renewals", "context": "{{input.payload.deal}}" },
 *     "webhook":   { "url": "{{callbackUrl}}", "token": "{{callbackToken}}" }
 *   }
 *
 * FOUR RULES, and they are all there is:
 *
 *  1. A string that is EXACTLY one placeholder is replaced by the VALUE, keeping
 *     its type — `"{{input.payload.deal}}"` yields the object, not its JSON text.
 *     That is what lets a template forward structured context without the
 *     provider having to parse a string containing JSON.
 *  2. A placeholder INSIDE a longer string interpolates as text, so
 *     `"Deal {{input.payload.name}} is at risk"` reads the way it looks.
 *  3. Only VALUES are templated, never keys. A provider's field names are part of
 *     its contract, not of the run.
 *  4. An unknown placeholder THROWS. It is a configuration typo, and the
 *     alternative — substituting an empty string — ships a half-empty brief to a
 *     provider that has no way to notice.
 *
 * `{{callbackUrl}}` carries the single-use bearer token in its path, so a
 * template must not put it anywhere a provider would echo publicly. The
 * connector's own log lines never contain it.
 */

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g
const WHOLE_PLACEHOLDER_PATTERN = /^\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}$/

export class GenericHttpTemplateError extends Error {
  readonly code = 'AGENT_HTTP_TEMPLATE_INVALID'
  constructor(message: string) {
    super(`[internal] ${message}`)
    this.name = 'GenericHttpTemplateError'
  }
}

export type RequestTemplateValues = {
  input: unknown
  callbackUrl: string
  callbackToken: string
}

/** Resolve one placeholder expression, or throw naming it. */
function resolveExpression(expression: string, values: RequestTemplateValues): unknown {
  if (expression === 'callbackUrl') return values.callbackUrl
  if (expression === 'callbackToken') return values.callbackToken
  if (expression === 'input') return values.input
  if (expression.startsWith('input.')) {
    return readInputPath(values.input, expression.slice('input.'.length))
  }
  throw new GenericHttpTemplateError(
    `the request body template references the unknown placeholder "{{${expression}}}"; supported placeholders are {{input}}, {{input.<path>}}, {{callbackUrl}} and {{callbackToken}}`,
  )
}

/**
 * Deliberately a private, minimal reader rather than a shared one: the input is
 * an object the workflow interpolated, so a path that misses is a MISSING VALUE
 * (rendered `null`) and never an error — an optional field that the author left
 * unset must not fail a run.
 */
function readInputPath(input: unknown, path: string): unknown {
  let current: unknown = input
  for (const segment of path.split('.')) {
    if (!segment.length) return undefined
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined
      current = current[Number.parseInt(segment, 10)]
      continue
    }
    if (typeof current !== 'object') return undefined
    current = Object.prototype.hasOwnProperty.call(current, segment)
      ? (current as Record<string, unknown>)[segment]
      : undefined
  }
  return current
}

/** How a resolved value reads when it is spliced INTO a longer string. */
function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function renderString(text: string, values: RequestTemplateValues): unknown {
  const whole = WHOLE_PLACEHOLDER_PATTERN.exec(text)
  if (whole) {
    const resolved = resolveExpression(whole[1], values)
    // `undefined` would make `JSON.stringify` DROP the key, so an unset optional
    // input would silently change the request's shape rather than its content.
    return resolved === undefined ? null : resolved
  }
  return text.replace(PLACEHOLDER_PATTERN, (_match, expression: string) =>
    toText(resolveExpression(expression, values)),
  )
}

/** Render a parsed template document against one run's values. */
export function renderRequestTemplate(template: unknown, values: RequestTemplateValues): unknown {
  if (typeof template === 'string') return renderString(template, values)
  if (Array.isArray(template)) return template.map((entry) => renderRequestTemplate(entry, values))
  if (template && typeof template === 'object') {
    const rendered: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(template as Record<string, unknown>)) {
      rendered[key] = renderRequestTemplate(value, values)
    }
    return rendered
  }
  return template
}
