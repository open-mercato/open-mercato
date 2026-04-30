// Hostname normalization for the custom-domain routing feature.
// Single canonical form (lowercase, no trailing dot, IDN→Punycode) is essential —
// the UNIQUE constraint on `domain_mappings.hostname` is meaningless without it.

const MAX_HOSTNAME_LENGTH = 253
const HOSTNAME_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

export class HostnameNormalizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HostnameNormalizationError'
  }
}

export function normalizeHostname(input: string): string {
  if (typeof input !== 'string') {
    throw new HostnameNormalizationError('Hostname must be a string')
  }

  let host = input.trim().toLowerCase()
  if (!host) throw new HostnameNormalizationError('Hostname is empty')

  host = host
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\?.*$/, '')
    .replace(/#.*$/, '')
    .replace(/:\d+$/, '')

  if (host.endsWith('.')) host = host.slice(0, -1)

  if (!host) throw new HostnameNormalizationError('Hostname is empty after stripping')

  // Convert IDN (Unicode) to Punycode (ASCII) via the URL constructor — this
  // matches what browsers and Let's Encrypt use, without depending on the
  // deprecated `node:punycode` module or pulling in `tr46`.
  try {
    const url = new URL(`https://${host}`)
    host = url.hostname
  } catch {
    throw new HostnameNormalizationError(`Hostname is not a valid host: ${input}`)
  }

  if (!host || host.length > MAX_HOSTNAME_LENGTH) {
    throw new HostnameNormalizationError(
      `Hostname must be between 1 and ${MAX_HOSTNAME_LENGTH} characters after normalization`,
    )
  }

  const labels = host.split('.')
  if (labels.length < 2) {
    throw new HostnameNormalizationError('Hostname must have at least two labels (e.g. "example.com")')
  }
  for (const label of labels) {
    if (!HOSTNAME_LABEL.test(label)) {
      throw new HostnameNormalizationError(`Invalid DNS label: "${label}"`)
    }
  }

  return host
}

export function tryNormalizeHostname(input: string): string | null {
  try {
    return normalizeHostname(input)
  } catch {
    return null
  }
}
