export function parseSelectedOrganizationCookie(header: string | null | undefined): string | null {
  if (!header) return null
  const parts = header.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.startsWith('om_selected_org=')) {
      const raw = trimmed.slice('om_selected_org='.length)
      try {
        const decoded = decodeURIComponent(raw)
        return decoded || null
      } catch {
        return raw || null
      }
    }
  }
  return null
}

export function parseSelectedTenantCookie(header: string | null | undefined): string | null {
  if (!header) return null
  const parts = header.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.startsWith('om_selected_tenant=')) {
      const raw = trimmed.slice('om_selected_tenant='.length)
      try {
        const decoded = decodeURIComponent(raw)
        return decoded || null
      } catch {
        return raw || null
      }
    }
  }
  return null
}

