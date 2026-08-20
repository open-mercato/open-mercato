export const EXTENSION_PAYLOAD_TRANSPORT_KEY = '__om_ext_v1'

export interface ParsedExtensionPayload {
  [moduleId: string]: Record<string, unknown>
}

const MAX_EXTENSION_PAYLOAD_DEPTH = 8
const MAX_EXTENSION_PAYLOAD_KEYS = 200

export function isExtensionPayloadRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeExtensionPayloadValue(value: unknown, depth: number, state: { keyCount: number }): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (depth >= MAX_EXTENSION_PAYLOAD_DEPTH) return undefined
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeExtensionPayloadValue(item, depth + 1, state)).filter((item) => item !== undefined)
  }
  if (!isExtensionPayloadRecord(value)) return undefined

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (state.keyCount >= MAX_EXTENSION_PAYLOAD_KEYS) break
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    const sanitized = sanitizeExtensionPayloadValue(item, depth + 1, state)
    if (sanitized === undefined) continue
    state.keyCount += 1
    result[key] = sanitized
  }
  return result
}

export function sanitizeExtensionPayload(value: unknown): ParsedExtensionPayload | undefined {
  if (!isExtensionPayloadRecord(value)) return undefined
  const result: ParsedExtensionPayload = {}
  const state = { keyCount: 0 }
  for (const [moduleId, modulePayload] of Object.entries(value)) {
    const sanitized = sanitizeExtensionPayloadValue(modulePayload, 0, state)
    if (isExtensionPayloadRecord(sanitized)) result[moduleId] = sanitized
  }
  return Object.keys(result).length ? result : undefined
}

export function mergeExtensionPayload(base: unknown, addition: unknown): ParsedExtensionPayload | undefined {
  const merged: ParsedExtensionPayload = {}
  for (const payload of [base, addition]) {
    const sanitized = sanitizeExtensionPayload(payload)
    if (!sanitized) continue
    for (const [moduleId, modulePayload] of Object.entries(sanitized)) {
      merged[moduleId] = { ...(merged[moduleId] ?? {}), ...modulePayload }
    }
  }
  return Object.keys(merged).length ? merged : undefined
}

export function extractExtensionPayload(body: unknown): {
  entityBody: unknown
  extensionPayload: ParsedExtensionPayload | undefined
} {
  if (!isExtensionPayloadRecord(body)) return { entityBody: body, extensionPayload: undefined }
  const { [EXTENSION_PAYLOAD_TRANSPORT_KEY]: payload, ...entityBody } = body
  return { entityBody, extensionPayload: sanitizeExtensionPayload(payload) }
}
