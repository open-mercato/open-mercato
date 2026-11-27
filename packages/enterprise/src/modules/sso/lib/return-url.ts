export function sanitizeReturnUrl(raw: string | null): string {
  const value = raw || '/backend'
  if (!value.startsWith('/') || value.startsWith('//')) return '/backend'
  try {
    const parsed = new URL(value, 'http://localhost')
    if (parsed.origin !== 'http://localhost' || parsed.pathname.startsWith('//')) return '/backend'
    return parsed.pathname + parsed.search + parsed.hash
  } catch {
    return '/backend'
  }
}
