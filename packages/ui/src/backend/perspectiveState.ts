export const PERSPECTIVE_COOKIE_PREFIX = 'om_table_perspective'
export const PERSPECTIVE_STORAGE_PREFIX = 'om_table_perspective_snapshot'

/**
 * Purge every browser-local DataTable perspective snapshot and active-view cookie
 * across all tables in this origin. Snapshots persist the unsaved/live table state
 * (column widths, order, visibility) keyed only by `tableId`, so they are shared by
 * every account that signs in on the same browser profile. Call this at the auth
 * identity boundary so one user's unsaved layout never carries over to a different
 * user — including a different tenant — reusing the same browser tab (#4185).
 *
 * Lives here rather than in DataTable so the backend shell can call it without
 * pulling the whole table implementation into the bundle of every backend page.
 * `@open-mercato/ui/backend/DataTable` re-exports it, which is the published
 * import path and must stay stable.
 */
export function clearAllPerspectiveState(): void {
  if (typeof window !== 'undefined') {
    try {
      const storage = window.localStorage
      const staleKeys: string[] = []
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index)
        if (key && key.startsWith(`${PERSPECTIVE_STORAGE_PREFIX}:`)) staleKeys.push(key)
      }
      for (const key of staleKeys) storage.removeItem(key)
    } catch {
      // private mode / quota errors are non-fatal
    }
  }
  if (typeof document !== 'undefined') {
    try {
      const cookies = document.cookie ? document.cookie.split(';') : []
      for (const cookie of cookies) {
        const name = cookie.split('=')[0]?.trim()
        if (name && name.startsWith(`${PERSPECTIVE_COOKIE_PREFIX}:`)) {
          document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`
        }
      }
    } catch {
      // ignore — cookie access can throw in sandboxed contexts
    }
  }
}
