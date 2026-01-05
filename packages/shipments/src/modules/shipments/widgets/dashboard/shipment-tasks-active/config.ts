export type ShipmentTasksActiveSettings = {
    pageSize: number
}

export const DEFAULT_SETTINGS: ShipmentTasksActiveSettings = {
    pageSize: 5,
}

export function hydrateTasksActiveSettings(raw: unknown): ShipmentTasksActiveSettings {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
    const input = raw as Partial<ShipmentTasksActiveSettings>
    const parsedPageSize = Number((input as any).pageSize)
    const pageSize =
        Number.isFinite(parsedPageSize) && parsedPageSize >= 1 && parsedPageSize <= 20
            ? Math.floor(parsedPageSize)
            : DEFAULT_SETTINGS.pageSize
    return { pageSize }
}