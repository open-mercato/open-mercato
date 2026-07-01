"use client"

import * as React from 'react'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SURFACE_CATALOG } from '@open-mercato/shared/lib/introspection/surface-catalog'
import type { PlatformMap, SurfaceRow } from '@open-mercato/shared/lib/introspection/types'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'

const API_PATH = '/api/platform/inspect'

type FetchState = {
  loading: boolean
  error: string | null
  rows: SurfaceRow[]
}

function isPlatformMap(payload: unknown): payload is PlatformMap {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as { schemaVersion?: unknown; surfaces?: unknown }
  return typeof value.schemaVersion === 'number' && typeof value.surfaces === 'object' && value.surfaces !== null
}

function formatCell(value: string | number | boolean | string[] | null | undefined): string {
  if (value == null) return '—'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

function buildColumns(rows: SurfaceRow[]) {
  if (rows.length === 0) return []
  const keys = Object.keys(rows[0])
  return keys.map((key) => ({
    header: key,
    accessorKey: key,
    cell: ({ row }: { row: { original: SurfaceRow } }) => {
      const value = row.original[key]
      if (key === 'status' && typeof value === 'string') {
        const variant = value === 'ok' ? 'success' : value === 'dead-event' ? 'warning' : 'error'
        return <StatusBadge variant={variant}>{value}</StatusBadge>
      }
      return formatCell(value)
    },
  }))
}

export function PlatformMapScreen() {
  const t = useT()
  const [surfaceId, setSurfaceId] = React.useState('event')
  const [tier, setTier] = React.useState<'1' | '2' | '3'>('2')
  const [state, setState] = React.useState<FetchState>({ loading: true, error: null, rows: [] })

  const loadSurface = React.useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const query = new URLSearchParams({ surface: surfaceId, tier })
      const payload = await readApiResultOrThrow<unknown>(`${API_PATH}?${query.toString()}`, undefined, {
        errorMessage: t('platform.map.error', 'Failed to load platform map'),
      })
      if (!isPlatformMap(payload)) {
        setState({
          loading: false,
          error: t('platform.map.invalidResponse', 'Unexpected platform map response'),
          rows: [],
        })
        return
      }
      const surface = payload.surfaces[surfaceId]
      setState({
        loading: false,
        error: null,
        rows: surface?.rows ?? [],
      })
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t('platform.map.error', 'Failed to load platform map')
      setState({ loading: false, error: message, rows: [] })
    }
  }, [surfaceId, tier, t])

  React.useEffect(() => {
    void loadSurface()
  }, [loadSurface])

  const columns = React.useMemo(() => buildColumns(state.rows), [state.rows])
  const selectedSurface = SURFACE_CATALOG.find((entry) => entry.id === surfaceId)

  return (
    <div className="space-y-6">
      <SectionHeader title={t('platform.map.pageTitle', 'Platform map')} />
      <p className="text-sm text-muted-foreground">
        {t('platform.map.description', 'Read-only view of wired extension surfaces in this app.')}
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[220px] space-y-1">
          <label htmlFor="platform-map-surface" className="text-sm font-medium">
            {t('platform.map.surface', 'Surface')}
          </label>
          <Select value={surfaceId} onValueChange={setSurfaceId}>
            <SelectTrigger id="platform-map-surface">
              <SelectValue placeholder={t('platform.map.surface', 'Surface')} />
            </SelectTrigger>
            <SelectContent>
              {SURFACE_CATALOG.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-[160px] space-y-1">
          <label htmlFor="platform-map-tier" className="text-sm font-medium">
            {t('platform.map.tier', 'Tier')}
          </label>
          <Select value={tier} onValueChange={(value) => setTier(value as '1' | '2' | '3')}>
            <SelectTrigger id="platform-map-tier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1</SelectItem>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="3">3</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedSurface ? (
        <p className="text-sm text-muted-foreground">
          {t('platform.map.surfaceMeta', {
            fallback: `Tier ${selectedSurface.tier} · ${state.rows.length} row(s)`,
            tier: selectedSurface.tier,
            count: state.rows.length,
          })}
        </p>
      ) : null}

      {state.loading ? <LoadingMessage message={t('platform.map.loading', 'Loading platform map…')} /> : null}
      {!state.loading && state.error ? <ErrorMessage message={state.error} onRetry={() => void loadSurface()} /> : null}

      {!state.loading && !state.error ? (
        <DataTable
          title={selectedSurface?.title ?? surfaceId}
          columns={columns}
          data={state.rows as Array<Record<string, unknown>>}
          emptyState={t('platform.map.empty', 'No rows for this surface.')}
          extensionTableId="platform.map.surface"
        />
      ) : null}
    </div>
  )
}
