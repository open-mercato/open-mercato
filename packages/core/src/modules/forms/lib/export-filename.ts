/** Build a portable attachment header while retaining the UTF-8 download name. */
export function buildJsonExportDisposition(filename: string): string {
  const displayName = filename.replace(/[\\/\u0000-\u001f\u007f]/g, '_')
  const fallback = displayName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
  const encoded = encodeURIComponent(displayName).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
