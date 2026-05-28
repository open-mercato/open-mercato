/**
 * Parse ISO 8601 duration to milliseconds
 *
 * Supports:
 * - ISO 8601: PT5M (5 minutes), PT1H (1 hour), P1D (1 day), P3D (3 days)
 * - Simple formats: 5m, 1h, 3d, 30s
 *
 * @param duration - Duration string
 * @returns Duration in milliseconds
 */
export function parseDuration(duration: string): number {
  // Try ISO 8601 format first: P[n]DT[n]H[n]M[n]S
  const iso8601Regex = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/
  const iso8601Match = duration.match(iso8601Regex)

  if (iso8601Match && iso8601Match[0] === duration) {
    const days = parseInt(iso8601Match[1] || '0')
    const hours = parseInt(iso8601Match[2] || '0')
    const minutes = parseInt(iso8601Match[3] || '0')
    const seconds = parseInt(iso8601Match[4] || '0')

    return (
      days * 24 * 60 * 60 * 1000 +
      hours * 60 * 60 * 1000 +
      minutes * 60 * 1000 +
      seconds * 1000
    )
  }

  // Try simple format: 1d, 5h, 30m, 45s
  const simpleRegex = /^(\d+)(d|h|m|s)$/
  const simpleMatch = duration.match(simpleRegex)

  if (simpleMatch) {
    const value = parseInt(simpleMatch[1])
    const unit = simpleMatch[2]

    switch (unit) {
      case 'd':
        return value * 24 * 60 * 60 * 1000
      case 'h':
        return value * 60 * 60 * 1000
      case 'm':
        return value * 60 * 1000
      case 's':
        return value * 1000
    }
  }

  throw new Error(`Invalid duration format: ${duration}`)
}
