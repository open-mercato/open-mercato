"use client"

/**
 * Demo dynamic AI UI part.
 *
 * Registered as `catalog.stats-card`. Tools (`catalog.show_stats`) emit a
 * `{ uiPart: { componentId: 'catalog.stats-card', payload: { ... } } }`
 * envelope and the chat client renders this card inline. Serves as the
 * canonical example for how third-party modules contribute custom AI UI
 * parts: define a presentational React component, register it on the
 * shared `defaultAiUiPartRegistry` once at module load, and the dispatcher
 * needs zero special handling.
 */

import * as React from 'react'
import { Boxes, FolderTree, PackageCheck, Tags } from 'lucide-react'
import {
  defaultAiUiPartRegistry,
  type AiUiPartProps,
} from '@open-mercato/ui/ai'

export interface CatalogStatsCardPayload {
  products?: number
  activeProducts?: number
  categories?: number
  tags?: number
  generatedAt?: string
  note?: string
}

function formatCount(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toLocaleString()
  }
  return '—'
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-2xl font-semibold leading-none">{value}</div>
    </div>
  )
}

export function CatalogStatsCard({ payload }: AiUiPartProps) {
  const data = (payload ?? {}) as CatalogStatsCardPayload
  return (
    <div
      className="rounded-lg border border-border bg-muted/30 p-3"
      data-ai-ui-part="catalog.stats-card"
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Boxes className="size-4 text-primary" aria-hidden />
        <span>Catalog overview</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          icon={<Boxes className="size-3" aria-hidden />}
          label="Products"
          value={formatCount(data.products)}
        />
        <StatTile
          icon={<PackageCheck className="size-3" aria-hidden />}
          label="Active"
          value={formatCount(data.activeProducts)}
        />
        <StatTile
          icon={<FolderTree className="size-3" aria-hidden />}
          label="Categories"
          value={formatCount(data.categories)}
        />
        <StatTile
          icon={<Tags className="size-3" aria-hidden />}
          label="Tags"
          value={formatCount(data.tags)}
        />
      </div>
      {data.note ? (
        <p className="mt-2 text-xs text-muted-foreground">{data.note}</p>
      ) : null}
      {data.generatedAt ? (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Snapshot at {new Date(data.generatedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  )
}

let registered = false
/**
 * Idempotent self-registration on the module-global UI-part registry.
 * Mirrors the pattern in `@open-mercato/ui/ai/records/registry` —
 * importing this file from a client module is enough for the registry
 * to know about `catalog.stats-card`.
 */
export function registerCatalogStatsCard(): void {
  if (registered) return
  registered = true
  defaultAiUiPartRegistry.register('catalog.stats-card', CatalogStatsCard)
}

registerCatalogStatsCard()
