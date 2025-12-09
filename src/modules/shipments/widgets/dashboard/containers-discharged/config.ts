export type ContainersDischargedSettings = {
    pageSize: number
}

export const DEFAULT_SETTINGS: ContainersDischargedSettings = {
    pageSize: 5,
}

export function hydrateDischargedSettings(raw: unknown): ContainersDischargedSettings {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
    const input = raw as Partial<ContainersDischargedSettings>
    const parsedPageSize = Number((input as any).pageSize)
    const pageSize =
        Number.isFinite(parsedPageSize) && parsedPageSize >= 1 && parsedPageSize <= 20
            ? Math.floor(parsedPageSize)
            : DEFAULT_SETTINGS.pageSize
    return { pageSize }
}