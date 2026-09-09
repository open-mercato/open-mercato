export type CollaborationEndpointOptions = {
  nodeEnv?: string
  allowLoopback?: boolean
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '::1'
    || hostname === '::'
    || hostname === '0.0.0.0'
    || /^127(?:\.|$)/.test(hostname)
    || /^::ffff:7f[0-9a-f]{2}:/.test(hostname)
    || hostname === '::ffff:0:0'
}

export function resolveDocumentsCollaborationEndpoint(
  raw = process.env.NEXT_PUBLIC_DOCUMENTS_COLLAB_URL,
  options: CollaborationEndpointOptions = {},
): string | null {
  if (!raw || raw !== raw.trim()) return null

  let endpoint: URL
  try {
    endpoint = new URL(raw)
  } catch {
    return null
  }

  const hostname = endpoint.hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '')
  if (!['ws:', 'wss:'].includes(endpoint.protocol) || !hostname) return null

  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV
  const allowLoopback = options.allowLoopback ?? (
    nodeEnv !== 'production' || process.env.OM_DOCUMENTS_COLLAB_INTEGRATION === '1'
  )
  if (!allowLoopback && isLoopbackHostname(hostname)) return null

  return raw
}
