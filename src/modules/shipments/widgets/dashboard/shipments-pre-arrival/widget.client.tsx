"use client"

import * as React from 'react'
import Link from 'next/link'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DEFAULT_SETTINGS, hydratePreArrivalSettings, type ShipmentsPreArrivalSettings } from './config'

type ShipmentItem = {
    id: string
    internalReference: string | null
    containerNumber: string | null
    clientName: string | null
    carrier: string | null
    originPort: string | null
    destinationPort: string | null
    eta: string | null
    vesselName: string | null
    voyageNumber: string | null
}

async function loadPreArrivalShipments(settings: ShipmentsPreArrivalSettings): Promise<ShipmentItem[]> {
    const params = new URLSearchParams({
        page: '1',
        pageSize: String(settings.pageSize),
        status: 'PRE_ARRIVAL',
        sortBy: 'eta',
        sortOrder: 'asc',
    })
    const call = await apiCall<{ items?: unknown[]; error?: string }>(`/api/shipments?${params.toString()}`)
    if (!call.ok) {
        const message =
            typeof (call.result as Record<string, unknown> | null)?.error === 'string'
                ? ((call.result as Record<string, unknown>).error as string)
                : `Request failed with status ${call.status}`
        throw new Error(message)
    }
    const payload = call.result ?? {}
    const rawItems = Array.isArray((payload as { items?: unknown[] }).items)
        ? (payload as { items: unknown[] }).items
        : []
    return rawItems
        .map((item): ShipmentItem | null => {
            if (!item || typeof item !== 'object') return null
            const data = item as any
            return {
                id: typeof data.id === 'string' ? data.id : null,
                internalReference: typeof data.internalReference === 'string' ? data.internalReference : null,
                containerNumber: typeof data.containerNumber === 'string' ? data.containerNumber : null,
                clientName: data.client?.name ?? null,
                carrier: typeof data.carrier === 'string' ? data.carrier : null,
                originPort: typeof data.originPort === 'string' ? data.originPort : null,
                destinationPort: typeof data.destinationPort === 'string' ? data.destinationPort : null,
                eta: typeof data.eta === 'string' ? data.eta : null,
                vesselName: typeof data.vesselName === 'string' ? data.vesselName : null,
                voyageNumber: typeof data.voyageNumber === 'string' ? data.voyageNumber : null,
            }
        })
        .filter((item): item is ShipmentItem => !!item && !!item.id)
}

function formatDate(value: string | null, locale?: string): string {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString(locale ?? undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const ShipmentsPreArrivalWidget: React.FC<DashboardWidgetComponentProps<ShipmentsPreArrivalSettings>> = ({
    mode,
    settings = DEFAULT_SETTINGS,
    onSettingsChange,
    refreshToken,
    onRefreshStateChange,
}) => {
    const t = useT()
    const hydrated = React.useMemo(() => hydratePreArrivalSettings(settings), [settings])
    const [items, setItems] = React.useState<ShipmentItem[]>([])
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)
    const [locale, setLocale] = React.useState<string | undefined>(undefined)

    React.useEffect(() => {
        if (typeof navigator !== 'undefined') {
            setLocale(navigator.language)
        }
    }, [])

    const refresh = React.useCallback(async () => {
        onRefreshStateChange?.(true)
        setLoading(true)
        setError(null)
        try {
            const data = await loadPreArrivalShipments(hydrated)
            setItems(data)
        } catch (err) {
            console.error('Failed to load pre-arrival shipments widget data', err)
            setError('Failed to load shipments')
        } finally {
            setLoading(false)
            onRefreshStateChange?.(false)
        }
    }, [hydrated, onRefreshStateChange])

    React.useEffect(() => {
        refresh().catch(() => { })
    }, [refresh, refreshToken])

    if (mode === 'settings') {
        return (
            <div className="space-y-4 text-sm">
                <div className="space-y-1.5">
                    <label htmlFor="shipments-pre-arrival-page-size" className="text-xs font-semibold uppercase text-muted-foreground">
                        Items to display
                    </label>
                    <input
                        id="shipments-pre-arrival-page-size"
                        type="number"
                        min={1}
                        max={20}
                        className="w-24 rounded-md border px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        value={hydrated.pageSize}
                        onChange={(event) => {
                            const next = Number(event.target.value)
                            onSettingsChange({ ...hydrated, pageSize: Number.isFinite(next) ? next : hydrated.pageSize })
                        }}
                    />
                </div>
            </div>
        )
    }
    console.log("pre-arrival items", items)
    return (
        <div className="space-y-4">
            {error ? (
                <p className="text-sm text-destructive">{error}</p>
            ) : loading ? (
                <div className="flex h-32 items-center justify-center">
                    <Spinner className="h-6 w-6 text-muted-foreground" />
                </div>
            ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No shipments approaching destination</p>
            ) : (
                <ul className="space-y-3">
                    {items.map((item) => {
                        const href = `/backend/shipments/${encodeURIComponent(item.id)}`
                        const eta = formatDate(item.eta, locale)
                        const reference = item.internalReference || item.containerNumber || 'No Reference'
                        return (
                            <li key={item.id} className="rounded-md border p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-medium">{reference}</p>
                                        {item.clientName ? (
                                            <p className="text-xs text-muted-foreground">{item.clientName}</p>
                                        ) : null}
                                    </div>
                                    {eta ? (
                                        <p className="text-xs text-muted-foreground">ETA: {eta}</p>
                                    ) : null}
                                </div>
                                <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                                    {item.carrier ? <span>{item.carrier}</span> : null}
                                    {item.originPort && item.destinationPort ? (
                                        <span>{item.originPort} → {item.destinationPort}</span>
                                    ) : item.destinationPort ? (
                                        <span>To {item.destinationPort}</span>
                                    ) : null}
                                    {item.vesselName ? <span>{item.vesselName}</span> : null}
                                    {item.voyageNumber ? <span>V. {item.voyageNumber}</span> : null}
                                </div>
                                <div className="mt-2 text-xs">
                                    <Link className="text-primary hover:underline" href={href}>
                                        View Shipment
                                    </Link>
                                </div>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}

export default ShipmentsPreArrivalWidget