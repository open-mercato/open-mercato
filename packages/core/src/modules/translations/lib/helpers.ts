export function formatFieldLabel(field: string): string {
  if (field.includes('.')) {
    const parts = field.split('.')
    if (parts[0] === 'options' && parts.length === 3 && parts[2] === 'label') {
      const optValue = parts[1]
      return `${optValue.charAt(0).toUpperCase()}${optValue.slice(1)} (option)`
    }
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' > ')
  }
  return field
    .split('_')
    .map((segment) => (segment ? `${segment[0].toUpperCase()}${segment.slice(1)}` : ''))
    .join(' ')
    .trim() || field
}

export function formatEntityLabel(entityId: string, label?: string): string {
  if (label && label !== entityId) return label
  const parts = entityId.split(':')
  const name = parts.length > 1 ? parts[1] : parts[0]
  return formatFieldLabel(name)
}

export function buildEntityListUrl(entityType: string): string | null {
  const [module, entity] = entityType.split(':')
  if (!module || !entity) return null
  const prefix = `${module}_`
  const base = entity.startsWith(prefix) ? entity.slice(prefix.length) : entity
  const resource = base.endsWith('s') ? base : `${base}s`
  return `/api/${module}/${resource}`
}

export function getRecordLabel(item: Record<string, unknown>): string {
  return String(item.title ?? item.name ?? item.label ?? item.display_name ?? item.id ?? '')
}
