import * as React from 'react'
import * as LucideIcons from 'lucide-react'

type LucideIconComponent = React.ComponentType<{ className?: string }>

function toPascalCaseIconName(name: string): string {
  if (!name.includes('-') && !name.includes('_') && !name.includes(' ')) return name
  return name
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

export function resolveInjectedIcon(icon?: string, className = 'size-4'): React.ReactNode | null {
  if (!icon) return null
  const normalized = icon.trim()
  if (!normalized) return null

  const candidates = [normalized, toPascalCaseIconName(normalized)]
  const registry = LucideIcons as unknown as Record<string, LucideIconComponent | undefined>

  for (const candidate of candidates) {
    const IconComponent = registry[candidate]
    if (!IconComponent) continue
    return <IconComponent className={className} />
  }

  return null
}
