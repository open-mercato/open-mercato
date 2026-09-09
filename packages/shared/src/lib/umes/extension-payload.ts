export const EXTENSION_PAYLOAD_TRANSPORT_KEY = '__om_ext_v1'

export interface ParsedExtensionPayload {
  [moduleId: string]: Record<string, unknown>
}

const MAX_EXTENSION_PAYLOAD_DEPTH = 8
const MAX_EXTENSION_PAYLOAD_KEYS = 200
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

// `JSON.parse` turns `__proto__` into an own property, so an untrusted payload can carry it
// through `Object.entries`. Assigning such a key re-parents the accumulator and hands every
// interceptor an object whose `hasOwnProperty`/`toString` are attacker-chosen.
function isUnsafePayloadKey(key: string): boolean {
  return PROTOTYPE_KEYS.has(key)
}

function createAccumulator<T extends object>(): T {
  return Object.create(null) as T
}

function toPlainObject<T extends object>(accumulator: T): T {
  return { ...accumulator }
}

export function isExtensionPayloadRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeExtensionPayloadValue(value: unknown, depth: number, state: { keyCount: number }): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (depth >= MAX_EXTENSION_PAYLOAD_DEPTH) return undefined
  if (Array.isArray(value)) {
    const items: unknown[] = []
    for (const item of value) {
      if (state.keyCount >= MAX_EXTENSION_PAYLOAD_KEYS) break
      const sanitized = sanitizeExtensionPayloadValue(item, depth + 1, state)
      if (sanitized === undefined) continue
      state.keyCount += 1
      items.push(sanitized)
    }
    return items
  }
  if (!isExtensionPayloadRecord(value)) return undefined

  const result = createAccumulator<Record<string, unknown>>()
  for (const [key, item] of Object.entries(value)) {
    if (state.keyCount >= MAX_EXTENSION_PAYLOAD_KEYS) break
    if (isUnsafePayloadKey(key)) continue
    const sanitized = sanitizeExtensionPayloadValue(item, depth + 1, state)
    if (sanitized === undefined) continue
    state.keyCount += 1
    result[key] = sanitized
  }
  return toPlainObject(result)
}

export function sanitizeExtensionPayload(value: unknown): ParsedExtensionPayload | undefined {
  if (!isExtensionPayloadRecord(value)) return undefined
  const result = createAccumulator<ParsedExtensionPayload>()
  const state = { keyCount: 0 }
  for (const [moduleId, modulePayload] of Object.entries(value)) {
    if (isUnsafePayloadKey(moduleId)) continue
    const sanitized = sanitizeExtensionPayloadValue(modulePayload, 0, state)
    if (isExtensionPayloadRecord(sanitized)) result[moduleId] = sanitized
  }
  return Object.keys(result).length ? toPlainObject(result) : undefined
}

export function mergeExtensionPayload(base: unknown, addition: unknown): ParsedExtensionPayload | undefined {
  const merged = createAccumulator<ParsedExtensionPayload>()
  for (const payload of [base, addition]) {
    const sanitized = sanitizeExtensionPayload(payload)
    if (!sanitized) continue
    for (const [moduleId, modulePayload] of Object.entries(sanitized)) {
      if (isUnsafePayloadKey(moduleId)) continue
      merged[moduleId] = { ...(merged[moduleId] ?? {}), ...modulePayload }
    }
  }
  return Object.keys(merged).length ? toPlainObject(merged) : undefined
}

export function extractExtensionPayload(body: unknown): {
  entityBody: unknown
  extensionPayload: ParsedExtensionPayload | undefined
} {
  if (!isExtensionPayloadRecord(body)) return { entityBody: body, extensionPayload: undefined }
  const { [EXTENSION_PAYLOAD_TRANSPORT_KEY]: payload, ...entityBody } = body
  return { entityBody, extensionPayload: sanitizeExtensionPayload(payload) }
}
