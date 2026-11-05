export type TodoSettings = {
  pageSize: number
  showCompleted: boolean
}

export const DEFAULT_SETTINGS: TodoSettings = {
  pageSize: 5,
  showCompleted: true,
}

export function hydrateTodoSettings(raw: unknown): TodoSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const data = raw as Partial<TodoSettings>
  const pageSize = Number(data.pageSize)
  return {
    pageSize: Number.isFinite(pageSize) && pageSize >= 1 && pageSize <= 20 ? Math.floor(pageSize) : DEFAULT_SETTINGS.pageSize,
    showCompleted: data.showCompleted ?? DEFAULT_SETTINGS.showCompleted,
  }
}
