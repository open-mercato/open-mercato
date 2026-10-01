export function getProjectAccessScopeKey(timeProjectId?: string | null): string {
  const cookies = typeof document === 'undefined' ? [] : document.cookie.split(';')
  const readCookie = (name: string): string | null => {
    const prefix = `${name}=`
    const entry = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(prefix))
    return entry?.slice(prefix.length) || null
  }
  return JSON.stringify([timeProjectId ?? null, readCookie('om_selected_tenant'), readCookie('om_selected_org')])
}
