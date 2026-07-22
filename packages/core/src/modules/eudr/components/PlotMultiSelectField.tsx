"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { resolveCountryName } from '@open-mercato/shared/lib/location/countries'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { PICKER_PAGE_SIZE } from './formConfig'

type PlotOption = {
  id: string
  name: string
  originCountry: string | null
  plotType: string | null
  areaHa: number | string | null
}

type PlotListResponse = {
  items?: unknown[]
}

export type PlotMultiSelectFieldProps = {
  id: string
  value: string[]
  onChange: (value: string[]) => void
  supplierEntityId?: string | null
  disabled?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizePlotOption(raw: unknown): PlotOption | null {
  if (!isRecord(raw)) return null
  const id = readString(raw, 'id')
  const name = readString(raw, 'name')
  if (!id || !name) return null
  const areaHa = raw.areaHa
  return {
    id,
    name,
    originCountry: readString(raw, 'originCountry'),
    plotType: readString(raw, 'plotType'),
    areaHa: typeof areaHa === 'number' || typeof areaHa === 'string' ? areaHa : null,
  }
}

function formatArea(value: PlotOption['areaHa'], emptyLabel: string): string {
  if (value === null || value === undefined || value === '') return emptyLabel
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(numeric)
}

export function PlotMultiSelectField({
  id,
  value,
  onChange,
  supplierEntityId,
  disabled,
}: PlotMultiSelectFieldProps) {
  const translate = useT()
  const locale = useLocale()
  const router = useRouter()
  const [plotNames, setPlotNames] = React.useState<Record<string, string | null>>({})
  const selectedPlotIds = React.useMemo(() => (Array.isArray(value) ? value : []), [value])
  const selectedIds = React.useMemo(() => new Set(selectedPlotIds), [selectedPlotIds])
  const normalizedSupplierId = typeof supplierEntityId === 'string' && supplierEntityId.trim().length > 0
    ? supplierEntityId.trim()
    : null
  const previousSupplierIdRef = React.useRef(normalizedSupplierId)

  React.useEffect(() => {
    const previousSupplierId = previousSupplierIdRef.current
    previousSupplierIdRef.current = normalizedSupplierId
    if (previousSupplierId === normalizedSupplierId || selectedPlotIds.length === 0) return
    onChange([])
  }, [normalizedSupplierId, onChange, selectedPlotIds.length])

  React.useEffect(() => {
    const missing = selectedPlotIds.filter((plotId) => !(plotId in plotNames))
    if (!missing.length) return
    let cancelled = false
    async function resolveNames() {
      const params = new URLSearchParams({ ids: missing.join(','), pageSize: '100' })
      const call = await apiCall<PlotListResponse>(
        `/api/eudr/plots?${params.toString()}`,
        undefined,
        { fallback: { items: [] } },
      )
      if (cancelled) return
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      const resolved: Record<string, string | null> = {}
      for (const plotId of missing) resolved[plotId] = null
      for (const item of items) {
        const option = normalizePlotOption(item)
        if (option) resolved[option.id] = option.name
      }
      setPlotNames((current) => ({ ...current, ...resolved }))
    }
    resolveNames().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [plotNames, selectedPlotIds])

  const plotSubtitle = React.useCallback((plot: PlotOption): string => {
    const country = plot.originCountry
      ? `${resolveCountryName(plot.originCountry, { locale })} (${plot.originCountry})`
      : translate('eudr.common.empty')
    const plotType = plot.plotType ?? 'point'
    const area = translate('eudr.plots.list.areaHaValue', {
      value: formatArea(plot.areaHa, translate('eudr.common.empty')),
    })
    return `${country} - ${translate(`eudr.plotType.${plotType}`)} - ${area}`
  }, [locale, translate])

  const fetchPlotItems = React.useCallback(async (query: string): Promise<LookupSelectItem[]> => {
    if (!normalizedSupplierId) return []
    const params = new URLSearchParams({
      page: '1',
      pageSize: String(PICKER_PAGE_SIZE),
      supplierEntityId: normalizedSupplierId,
      isActive: 'true',
    })
    if (query) params.set('search', query)
    const call = await apiCall<PlotListResponse>(
      `/api/eudr/plots?${params.toString()}`,
      undefined,
      { fallback: { items: [] } },
    )
    if (!call.ok) {
      flash(translate('eudr.evidenceSubmissions.form.plotsLoadError'), 'error')
      return []
    }
    const items = Array.isArray(call.result?.items) ? call.result.items : []
    const options = items
      .map((item) => normalizePlotOption(item))
      .filter((option): option is PlotOption => option !== null)
    setPlotNames((current) => {
      const next = { ...current }
      for (const option of options) next[option.id] = option.name
      return next
    })
    return options.map((option) => ({
      id: option.id,
      title: option.name,
      subtitle: plotSubtitle(option),
      disabled: selectedIds.has(option.id),
    }))
  }, [normalizedSupplierId, plotSubtitle, selectedIds, translate])

  const addPlot = React.useCallback((plotId: string | null) => {
    if (!plotId || selectedIds.has(plotId)) return
    onChange([...selectedPlotIds, plotId])
  }, [onChange, selectedIds, selectedPlotIds])

  const removePlot = React.useCallback((plotId: string) => {
    onChange(selectedPlotIds.filter((entry) => entry !== plotId))
  }, [onChange, selectedPlotIds])

  return (
    <div id={id} className="space-y-3">
      {!normalizedSupplierId ? (
        <p className="rounded-md border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {translate('eudr.evidenceSubmissions.form.plotsSupplierHint')}
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {translate('eudr.evidenceSubmissions.form.plotsSelectedCount', { count: selectedPlotIds.length })}
            </p>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => router.push('/backend/eudr/plots/create')}
            >
              <Plus className="size-4" aria-hidden="true" />
              {translate('eudr.plots.list.actions.create')}
            </Button>
          </div>
          {selectedPlotIds.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {value
                .filter((plotId) => plotId in plotNames)
                .map((plotId) => {
                  const name = plotNames[plotId] ?? translate('eudr.common.recordUnavailable')
                  return (
                    <span
                      key={plotId}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 py-0.5 pl-3 pr-1 text-sm text-foreground"
                    >
                      <span className="max-w-56 truncate">{name}</span>
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={disabled}
                        aria-label={translate('eudr.evidenceSubmissions.form.plotsRemove', { name })}
                        onClick={() => removePlot(plotId)}
                      >
                        <X className="size-3" aria-hidden="true" />
                      </IconButton>
                    </span>
                  )
                })}
            </div>
          ) : null}
          <LookupSelect
            key={normalizedSupplierId}
            value={null}
            minQuery={0}
            disabled={disabled}
            searchPlaceholder={translate('eudr.plots.list.searchPlaceholder')}
            fetchItems={fetchPlotItems}
            onChange={addPlot}
          />
        </>
      )}
    </div>
  )
}

export default PlotMultiSelectField
