import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

function humanizeSegment(segment: string): string {
  return segment
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function formatEntityId(entityId: string): string {
  if (!entityId.includes(':')) return humanizeSegment(entityId)
  const [module, entity] = entityId.split(':')
  return `${humanizeSegment(module)} · ${humanizeSegment(entity)}`
}

export function resolveEntityTypeLabel(t: TranslateFn, entityId: string): string {
  const fallback = formatEntityId(entityId)
  if (!entityId.includes(':')) return fallback
  const [module, entity] = entityId.split(':')
  return t(`search.entityType.${module}.${entity}`, fallback)
}
