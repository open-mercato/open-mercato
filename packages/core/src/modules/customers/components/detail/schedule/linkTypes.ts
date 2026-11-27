import type { ComponentType } from 'react'
import { Building2, Briefcase } from 'lucide-react'
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import type { LinkedEntity } from './useScheduleFormState'

export type ScheduleLinkTypeDefinition = {
  id: LinkedEntity['type']
  label: string
  labelKey: string
  icon?: ComponentType<{ className?: string }>
  buildSearchUrl: (input: { page: number; pageSize: number; query: string }) => string
  resolveLabel: (item: Record<string, unknown>) => string
}

export type ScheduleLinkTypeWidget = InjectionWidgetModule & {
  linkTypes: readonly ScheduleLinkTypeDefinition[]
}

function readLabel(item: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return String(item.id ?? '')
}

const builtInLinkTypes: readonly ScheduleLinkTypeDefinition[] = [
  {
    id: 'company',
    label: 'Company',
    labelKey: 'customers.schedule.linkType.company',
    icon: Building2,
    buildSearchUrl: ({ page, pageSize, query }) =>
      `/api/customers/companies?sortField=name&sortDir=asc&page=${page}&pageSize=${pageSize}${query.trim() ? `&search=${encodeURIComponent(query.trim())}` : ''}`,
    resolveLabel: (item) => readLabel(item, ['display_name', 'displayName', 'name', 'title']),
  },
  {
    id: 'deal',
    label: 'Deal',
    labelKey: 'customers.schedule.linkType.deal',
    icon: Briefcase,
    buildSearchUrl: ({ page, pageSize, query }) =>
      `/api/customers/deals?pageSize=${pageSize}&page=${page}${query.trim() ? `&search=${encodeURIComponent(query.trim())}` : ''}`,
    resolveLabel: (item) => readLabel(item, ['title', 'name', 'display_name', 'displayName']),
  },
]

function isLinkTypeDefinition(value: unknown): value is ScheduleLinkTypeDefinition {
  if (!value || typeof value !== 'object') return false
  const definition = value as Record<string, unknown>
  return (definition.id === 'company' || definition.id === 'deal' || definition.id === 'offer')
    && typeof definition.label === 'string'
    && typeof definition.labelKey === 'string'
    && typeof definition.buildSearchUrl === 'function'
    && typeof definition.resolveLabel === 'function'
}

export function resolveScheduleLinkTypes(modules: readonly InjectionWidgetModule[]): ScheduleLinkTypeDefinition[] {
  const types = new Map(builtInLinkTypes.map((definition) => [definition.id, definition]))
  for (const module of modules) {
    if (!('linkTypes' in module) || !Array.isArray(module.linkTypes)) continue
    for (const definition of module.linkTypes) {
      if (isLinkTypeDefinition(definition) && !types.has(definition.id)) {
        types.set(definition.id, definition)
      }
    }
  }
  return Array.from(types.values())
}
