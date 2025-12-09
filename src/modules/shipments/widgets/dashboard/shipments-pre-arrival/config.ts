export type ShipmentsPreArrivalSettings = {
    pageSize: number
}

export const DEFAULT_SETTINGS: ShipmentsPreArrivalSettings = {
    pageSize: 5,
}

export function hydratePreArrivalSettings(raw: unknown): ShipmentsPreArrivalSettings {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
    const input = raw as Partial<ShipmentsPreArrivalSettings>
    const parsedPageSize = Number((input as any).pageSize)
    const pageSize =
        Number.isFinite(parsedPageSize) && parsedPageSize >= 1 && parsedPageSize <= 20
            ? Math.floor(parsedPageSize)
            : DEFAULT_SETTINGS.pageSize
    return { pageSize }
}