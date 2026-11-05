import type * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { LUCIDE_ICON_REGISTRY } from './lucideRegistry.generated'

function normalizeKebabIconName(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const withoutPrefix = trimmed.startsWith('lucide:') ? trimmed.slice('lucide:'.length) : trimmed
  if (!withoutPrefix) return ''
  if (!withoutPrefix.includes('-') && !withoutPrefix.includes('_') && !withoutPrefix.includes(' ') && /[A-Z]/.test(withoutPrefix)) {
    return withoutPrefix
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
      .toLowerCase()
  }
  return withoutPrefix
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
}

export function resolveRegisteredLucideIcon(name: string | undefined): LucideIcon | null {
  if (!name) return null
  const normalized = normalizeKebabIconName(name)
  if (!normalized) return null
  return (LUCIDE_ICON_REGISTRY as Record<string, LucideIcon | undefined>)[normalized] ?? null
}

export function resolveRegisteredLucideIconNode(
  name: string | undefined,
  className: string
): React.ReactNode | null {
  const Icon = resolveRegisteredLucideIcon(name)
  if (!Icon) return null
  return <Icon className={className} />
}
