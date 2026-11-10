/**
 * Workflows Module - Zod-to-ledger schema flattener (spec
 * 2026-07-26-workflows-ux-redesign.md section 3.1).
 *
 * Pure translation of an activity output Zod schema (e.g. a command's
 * `outputSchema` resolved by UPDATE_ENTITY's outputContract) into the minimal
 * `LedgerContract` shape `computeContextLedger` consumes through its injected
 * `resolveOutputContract` seam. Only value dependency is zod itself
 * (browser-safe, already loaded by the validators) — no React, no ORM, no DI.
 *
 * Mapping rules, honest by construction:
 * - Only object roots flatten: each property becomes a dot-path entry
 *   (`customer.address.city`). Non-object roots (scalars, arrays, effects)
 *   return the string `'unknown'` because the ledger namespaces contract
 *   entries under a result key and a root scalar has no property path.
 * - Scalars map string→text, number→number, boolean→boolean, enum→select,
 *   date→date. Pass-through wrappers that do not hide the inner type
 *   (optional, nullable, default, readonly, nonoptional, catch) are unwrapped
 *   first.
 * - Arrays of objects collapse to one `object`-typed entry for the array path
 *   — indices are never exploded. Arrays of anything else are `unknown`.
 * - Nested objects recurse up to `maxDepth` path segments (default 3); an
 *   object property sitting at the cap is emitted as one `object`-typed entry
 *   instead of recursing.
 * - Anything unmappable — unions of mixed kinds, records, pipes/transforms
 *   that hide the inner type, literals — becomes a named `unknown` entry
 *   rather than a guessed type; an empty or fully-unresolvable shape returns
 *   `'unknown'` outright.
 */

import { ZodType } from 'zod'
import type { ZodTypeAny } from 'zod'
import type { LedgerContract, LedgerType } from './context-ledger'

export interface FlattenSchemaOptions {
  maxDepth?: number
}

const DEFAULT_MAX_DEPTH = 3
const WRAPPER_UNWRAP_CAP = 8

const SCALAR_KIND_MAP: Record<string, LedgerType> = {
  string: 'text',
  number: 'number',
  boolean: 'boolean',
  enum: 'select',
  date: 'date',
}

const WRAPPER_KINDS = new Set([
  'optional',
  'nullable',
  'default',
  'readonly',
  'nonoptional',
  'catch',
])

type UnknownRecord = Record<string, unknown>

type ContractEntry = LedgerContract['entries'][number]

function isZodSchema(value: unknown): value is ZodTypeAny {
  return value instanceof ZodType
}

function defOf(schema: ZodTypeAny): UnknownRecord {
  const def = (schema as unknown as { def?: unknown }).def
  return typeof def === 'object' && def !== null ? (def as UnknownRecord) : {}
}

function kindOf(schema: ZodTypeAny): string {
  const kind = defOf(schema).type
  return typeof kind === 'string' ? kind : 'unknown'
}

function unwrapSchema(schema: ZodTypeAny): ZodTypeAny {
  let current = schema
  for (let pass = 0; pass < WRAPPER_UNWRAP_CAP; pass += 1) {
    if (!WRAPPER_KINDS.has(kindOf(current))) return current
    const inner = defOf(current).innerType
    if (!isZodSchema(inner)) return current
    current = inner
  }
  return current
}

function arrayEntryType(arraySchema: ZodTypeAny): LedgerType {
  const element = defOf(arraySchema).element
  if (isZodSchema(element) && kindOf(unwrapSchema(element)) === 'object') return 'object'
  return 'unknown'
}

function collectObjectEntries(
  objectSchema: ZodTypeAny,
  prefix: string,
  depth: number,
  maxDepth: number,
  entries: ContractEntry[],
): void {
  const shape = defOf(objectSchema).shape
  if (typeof shape !== 'object' || shape === null) return
  for (const [name, property] of Object.entries(shape as UnknownRecord)) {
    if (!name || !isZodSchema(property)) continue
    const path = prefix ? `${prefix}.${name}` : name
    const resolved = unwrapSchema(property)
    const kind = kindOf(resolved)
    const scalarType = SCALAR_KIND_MAP[kind]
    if (scalarType) {
      entries.push({ path, type: scalarType })
    } else if (kind === 'object') {
      if (depth < maxDepth) {
        collectObjectEntries(resolved, path, depth + 1, maxDepth, entries)
      } else {
        entries.push({ path, type: 'object' })
      }
    } else if (kind === 'array') {
      entries.push({ path, type: arrayEntryType(resolved) })
    } else {
      entries.push({ path, type: 'unknown' })
    }
  }
}

export function flattenSchemaToContract(
  schema: ZodTypeAny,
  options?: FlattenSchemaOptions,
): LedgerContract | 'unknown' {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH
  if (maxDepth < 1) return 'unknown'
  const root = unwrapSchema(schema)
  if (kindOf(root) !== 'object') return 'unknown'
  const entries: ContractEntry[] = []
  collectObjectEntries(root, '', 1, maxDepth, entries)
  if (entries.length === 0) return 'unknown'
  return { entries }
}
