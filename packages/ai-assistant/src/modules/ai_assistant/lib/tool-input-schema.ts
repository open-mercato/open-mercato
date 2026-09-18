import { z, type ZodTypeAny } from 'zod'

/**
 * Publish a tool's declared input as JSON Schema.
 *
 * Every place a tool is advertised — the MCP `tools/list` handler, the in-process client and
 * `GET /api/ai_assistant/tools` — used to call `zod-to-json-schema`, a Zod **3** converter. This
 * repository is on Zod 4, whose internals that package cannot read, so it silently returned
 * `{ "$schema": "…" }` for every tool: no `properties`, no `required`, nothing. It did not throw
 * and nothing failed a type check, so the tools kept listing and a model was simply never told
 * that `example.get_customer_priority` takes a `customerId`. An argument-free tool looked
 * identical to one with three required fields.
 *
 * Zod 4 ships its own converter, so the fix is to use it. Two deliberate choices:
 *
 * - `io: 'input'` — a tool schema describes what the CALLER sends. With the default (`'output'`)
 *   a field carrying a `.default()` is published as required-on-output, which is the opposite of
 *   what a caller needs to know.
 * - `unrepresentable: 'any'` — the default throws on a type with no JSON Schema form (`z.date()`,
 *   `z.bigint()`). Throwing here would take down the whole tool listing because one tool declared
 *   a date, so such a field is published as an unconstrained value instead.
 *
 * A schema that still cannot be converted degrades to the empty object schema rather than
 * propagating: listing the remaining tools is worth more than failing the request.
 */
export function toolInputJsonSchema(schema: ZodTypeAny | undefined): Record<string, unknown> {
  if (!schema) return { type: 'object', properties: {} }
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  } catch {
    return { type: 'object', properties: {} }
  }
}
