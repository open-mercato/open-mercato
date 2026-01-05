"use client"

import * as React from 'react'
import Link from 'next/link'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DEFAULT_SETTINGS, hydrateDischargedSettings, type ContainersDischargedSettings } from './config'

type ContainerItem = {
    id: string
    containerNumber: string | null
    containerType: string | null
    shipmentId: string | null
    shipmentReference: string | null
    currentLocation: string | null
    dischargedDate: string | null
    cargoDescription: string | null
}

async function loadDischargedContainers(settings: ContainersDischargedSettings): Promise<ContainerItem[]> {
    const params = new URLSearchParams({
        page: '1',
        pageSize: String(settings.pageSize),
        status: 'DISCHARGED',
        sortBy: 'dischargedDate',
        sortOrder: 'desc',
    })
    const call = await apiCall<{ items?: unknown[]; error?: string }>(`/api/shipments/containers?${params.toString()}`)
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
        .map((item): ContainerItem | null => {
            if (!item || typeof item !== 'object') return null
            const data = item as any
            return {
                id: typeof data.id === 'string' ? data.id : null,
                containerNumber: typeof data.containerNumber === 'string' ? data.containerNumber : null,
                containerType: typeof data.containerType === 'string' ? data.containerType : null,
                shipmentId: typeof data.shipmentId === 'string' ? data.shipmentId : null,
                shipmentReference: data.shipment?.internalReference ?? data.shipment?.containerNumber ?? null,
                currentLocation: typeof data.currentLocation === 'string' ? data.currentLocation : null,
                dischargedDate: typeof data.dischargedDate === 'string' ? data.dischargedDate : null,
                cargoDescription: typeof data.cargoDescription === 'string' ? data.cargoDescription : null,
            }
        })
        .filter((item): item is ContainerItem => !!item && !!item.id)
}

function formatDate(value: string | null, locale?: string): string {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString(locale ?? undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatContainerType(type: string | null): string {
    if (!type) return ''
    return type.replace(/([0-9]+)([A-Z]+)/, '$1\' $2')
}

const ContainersDischargedWidget: React.FC<DashboardWidgetComponentProps<ContainersDischargedSettings>> = ({
    mode,
    settings = DEFAULT_SETTINGS,
    onSettingsChange,
    refreshToken,
    onRefreshStateChange,
}) => {
    const t = useT()
    const hydrated = React.useMemo(() => hydrateDischargedSettings(settings), [settings])
    const [items, setItems] = React.useState<ContainerItem[]>([])
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
            const data = await loadDischargedContainers(hydrated)
            setItems(data)
        } catch (err) {
            console.error('Failed to load discharged containers widget data', err)
            setError('Failed to load containers')
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
                    <label htmlFor="containers-discharged-page-size" className="text-xs font-semibold uppercase text-muted-foreground">
                        Items to display
                    </label>
                    <input
                        id="containers-discharged-page-size"
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

    return (
        <div className="space-y-4">
            {error ? (
                <p className="text-sm text-destructive">{error}</p>
            ) : loading ? (
                <div className="flex h-32 items-center justify-center">
                    <Spinner className="h-6 w-6 text-muted-foreground" />
                </div>
            ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No discharged containers</p>
            ) : (
                <ul className="space-y-3">
                    {items.map((item) => {
                        const href = item.shipmentId ? `/backend/shipments/${encodeURIComponent(item.shipmentId)}` : '#'
                        const dischargedDate = formatDate(item.dischargedDate, locale)
                        const containerDisplay = item.containerNumber || 'Unknown Container'
                        return (
                            <li key={item.id} className="rounded-md border p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-medium">{containerDisplay}</p>
                                        {item.containerType ? (
                                            <p className="text-xs text-muted-foreground">{formatContainerType(item.containerType)}</p>
                                        ) : null}
                                    </div>
                                    {dischargedDate ? (
                                        <p className="text-xs text-muted-foreground">Discharged {dischargedDate}</p>
                                    ) : null}
                                </div>
                                {item.cargoDescription ? (
                                    <p className="mt-2 text-xs text-muted-foreground line-clamp-1">{item.cargoDescription}</p>
                                ) : null}
                                <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                                    {item.shipmentReference ? (
                                        <span>Shipment: {item.shipmentReference}</span>
                                    ) : null}
                                    {item.currentLocation ? (
                                        <span>Location: {item.currentLocation}</span>
                                    ) : null}
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

export default ContainersDischargedWidget