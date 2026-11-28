import { z } from 'zod'

export type PropKind = 'prop' | 'slot' | 'event'

export type PropRow = {
  name: string
  type: string
  required: boolean
  kind: PropKind
  description?: string
  depth: number
}

type JsonSchemaNode = {
  type?: string | string[]
  enum?: unknown[]
  const?: unknown
  anyOf?: JsonSchemaNode[]
  oneOf?: JsonSchemaNode[]
  allOf?: JsonSchemaNode[]
  items?: JsonSchemaNode
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  format?: string
  description?: string
  kind?: unknown
  $ref?: string
  $defs?: Record<string, JsonSchemaNode>
}

const MAX_DEPTH = 3

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNode(value: unknown): JsonSchemaNode {
  return isRecord(value) ? (value as JsonSchemaNode) : {}
}

function resolveRef(node: JsonSchemaNode, defs: Record<string, JsonSchemaNode>): JsonSchemaNode {
  if (!node.$ref) return node
  const name = node.$ref.split('/').pop() ?? ''
  return defs[name] ?? node
}

function kindOf(node: JsonSchemaNode): PropKind {
  if (node.kind === 'slot') return 'slot'
  if (node.kind === 'event') return 'event'
  return 'prop'
}

function formatLiteral(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : String(value)
}

export function formatJsonSchemaType(input: JsonSchemaNode, defs: Record<string, JsonSchemaNode> = {}): string {
  const node = resolveRef(input, defs)
  const kind = kindOf(node)
  if (kind === 'slot') return 'ReactNode'
  if (kind === 'event') return 'function'
  if (node.const !== undefined) return formatLiteral(node.const)
  if (node.enum) return node.enum.map(formatLiteral).join(' | ')
  const variants = node.anyOf ?? node.oneOf
  if (variants) return Array.from(new Set(variants.map((variant) => formatJsonSchemaType(variant, defs)))).join(' | ')
  if (node.allOf && node.allOf.length > 0) return formatJsonSchemaType(node.allOf[0], defs)
  const type = Array.isArray(node.type) ? node.type.join(' | ') : node.type
  if (type === 'array') {
    const item = formatJsonSchemaType(node.items ?? {}, defs)
    return item.includes(' | ') ? `(${item})[]` : `${item}[]`
  }
  if (type === 'string' && node.format === 'date-time') return 'string (ISO date-time)'
  if (type === 'integer') return 'number'
  if (type) return type
  return 'unknown'
}

function nestedObject(input: JsonSchemaNode, defs: Record<string, JsonSchemaNode>): { suffix: string; node: JsonSchemaNode } | null {
  const node = resolveRef(input, defs)
  if (node.type === 'object' && node.properties) return { suffix: '', node }
  if (node.type === 'array' && node.items) {
    const item = resolveRef(node.items, defs)
    if (item.type === 'object' && item.properties) return { suffix: '[]', node: item }
  }
  return null
}

function collectRows(
  node: JsonSchemaNode,
  defs: Record<string, JsonSchemaNode>,
  prefix: string,
  depth: number,
  rows: PropRow[],
): void {
  const required = new Set(node.required ?? [])
  for (const [key, rawChild] of Object.entries(node.properties ?? {})) {
    const child = resolveRef(asNode(rawChild), defs)
    const name = prefix ? `${prefix}.${key}` : key
    rows.push({
      name,
      type: formatJsonSchemaType(child, defs),
      required: required.has(key),
      kind: kindOf(child),
      ...(child.description ? { description: child.description } : {}),
      depth,
    })
    const nested = depth + 1 < MAX_DEPTH ? nestedObject(child, defs) : null
    if (nested) collectRows(nested.node, defs, `${name}${nested.suffix}`, depth + 1, rows)
  }
}

export function propsTableFromJsonSchema(schema: unknown): PropRow[] {
  const root = asNode(schema)
  const defs = root.$defs ?? {}
  const rows: PropRow[] = []
  collectRows(resolveRef(root, defs), defs, '', 0, rows)
  return rows
}

export function buildPropsTable(schema: z.ZodType): PropRow[] {
  const jsonSchema = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' })
  return propsTableFromJsonSchema(jsonSchema)
}
