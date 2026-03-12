/**
 * Generic timeline types — domain-agnostic.
 * Modules provide their own kind unions as type parameters.
 */

export type TimelineActor = {
  id: string | null
  label: string
}

export type FieldChange = {
  field: string
  label: string
  from: unknown
  to: unknown
}

export type TimelineEntry<K extends string = string> = {
  id: string
  kind: K
  occurredAt: string
  actor: TimelineActor
  summary: string
  detail: Record<string, unknown> | null
  changes: FieldChange[] | null
  entityContext?: { entityId: string; entityLabel: string } | null
  href?: string | null
}

export type AggregateOptions<K extends string = string> = {
  limit: number
  before: string | null
  types: Set<K> | null
}

export type TimelinePanelConfig<K extends string = string> = {
  allKinds: readonly K[]
  kindLabels: (t: (key: string, fallback: string) => string) => Record<K, string>
  kindIcons: Record<K, import('react').ComponentType<{ className?: string }>>
  kindBgColors: Record<K, string>
  kindIconColors: Record<K, string>
  resolveActivityIcon?: (detail: Record<string, unknown> | null) => import('react').ComponentType<{ className?: string }>
  panelWidth?: string
}
