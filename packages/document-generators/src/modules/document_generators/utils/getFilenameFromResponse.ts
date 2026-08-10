/**
 * Extracts the filename from a Content-Disposition response header.
 * Falls back to the provided default if the header is absent or unparseable.
 */
export function getFilenameFromResponse(response: Response, fallback: string): string {
  const disposition = response.headers.get('Content-Disposition')
  const match = disposition?.match(/filename="([^"]+)"/)
  return match?.[1] ?? fallback
}
