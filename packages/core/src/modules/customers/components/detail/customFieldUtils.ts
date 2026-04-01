"use client"

import { formatDateTime } from '@open-mercato/shared/lib/time'

function stripCustomFieldPrefix(value: string): string {
  return value.replace(/^(?:cf|Cf)(?:[_:\s-]+)/, '')
}

function normalizeCustomFieldToken(value: string): string {
  return stripCustomFieldPrefix(value.trim())
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

export function normalizeCustomFieldKey(key: string | null | undefined): string {
  if (typeof key !== 'string') return ''
  return normalizeCustomFieldToken(key)
}

export function formatCustomFieldLabel(key: string): string {
  if (!key) return ''
  const spaced = stripCustomFieldPrefix(key.trim())
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!spaced.length) return stripCustomFieldPrefix(key.trim())
  return spaced
    .split(' ')
    .map((part) => (part.length ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}

export function resolveCustomFieldLabel(label: string | null | undefined, key: string): string {
  const fallbackLabel = formatCustomFieldLabel(key)
  if (typeof label !== 'string') return fallbackLabel
  const trimmed = label.trim()
  if (!trimmed.length) return fallbackLabel

  const normalizedKey = normalizeCustomFieldKey(key)
  const normalizedLabel = normalizeCustomFieldToken(trimmed)
  if (normalizedKey && normalizedLabel === normalizedKey) {
    return fallbackLabel
  }

  return /^(?:cf|Cf)(?:[_:\s-]+)/.test(trimmed)
    ? formatCustomFieldLabel(trimmed)
    : trimmed
}

export function isEmptyCustomValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0 || value.every((entry) => isEmptyCustomValue(entry))
  if (typeof value === 'object') {
    try {
      return Object.values(value as Record<string, unknown>).every(isEmptyCustomValue)
    } catch {
      return false
    }
  }
  return false
}

export function stringifyCustomValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => stringifyCustomValue(entry))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    return parts.join(', ')
  }
  if (value instanceof Date) {
    const iso = value.toISOString()
    return formatDateTime(iso) ?? iso
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.length) return ''
    return formatDateTime(trimmed) ?? trimmed
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const candidate =
      record.label ?? record.name ?? record.title ?? record.value ?? record.id ?? record.key ?? null
    if (typeof candidate === 'string' && candidate.trim().length) {
      return candidate.trim()
    }
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return ''
}

export function extractDictionaryValue(entry: unknown): string | null {
  if (typeof entry === 'string') {
    const trimmed = entry.trim()
    return trimmed.length ? trimmed : null
  }
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const candidate = record.value ?? record.name ?? record.id ?? record.key ?? record.label
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim()
    return trimmed.length ? trimmed : null
  }
  return null
}

export function normalizeCustomFieldSubmitValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined)
  }
  if (value === undefined) return null
  return value
}
