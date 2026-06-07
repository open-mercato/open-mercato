import type { MessageObjectAction } from '@open-mercato/shared/modules/messages/types'
import type { MessageAction } from './types'

export function toErrorMessage(payload: unknown): string | null {
  if (!payload) return null
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = toErrorMessage(item)
      if (nested) return nested
    }
    return null
  }
  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    return (
      toErrorMessage(record.error)
      ?? toErrorMessage(record.message)
      ?? toErrorMessage(record.detail)
      ?? toErrorMessage(record.details)
      ?? null
    )
  }
  return null
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

const SAFE_NAVIGATION_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

export function isSafeNavigationHref(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('//')) return false
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return true
  }
  const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost'
  try {
    const parsed = new URL(trimmed, base)
    return SAFE_NAVIGATION_SCHEMES.has(parsed.protocol)
  } catch {
    return false
  }
}

export function parseObjectActionId(value: string): { objectId: string; actionId: string } | null {
  if (!value.startsWith('object:')) return null
  const [, objectId, ...rest] = value.split(':')
  if (!objectId || rest.length === 0) return null
  return { objectId, actionId: rest.join(':') }
}

function resolveObjectActionVariant(
  variant: MessageAction['variant'],
): MessageObjectAction['variant'] | undefined {
  if (variant === 'default' || variant === 'secondary' || variant === 'destructive' || variant === 'outline') {
    return variant
  }
  return undefined
}

export function toObjectAction(actionId: string, action: MessageAction): MessageObjectAction {
  return {
    id: actionId,
    labelKey: action.labelKey ?? action.label ?? actionId,
    variant: resolveObjectActionVariant(action.variant),
    icon: action.icon,
    commandId: action.commandId,
    href: action.href,
    isTerminal: action.isTerminal,
    confirmRequired: action.confirmRequired,
    confirmMessage: action.confirmMessage,
  }
}
