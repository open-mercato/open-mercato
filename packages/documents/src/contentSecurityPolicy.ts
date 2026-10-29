import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveDocumentsCollaborationEndpoint } from './modules/documents/lib/collabEndpoint'

export function resolveDocumentsCollaborationCspOrigins(): string[] {
  const endpoint = resolveDocumentsCollaborationEndpoint()
  if (!endpoint) return []
  const url = new URL(endpoint)
  if (url.username || url.password || !/^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])$/i.test(url.hostname)) {
    createLogger('documents:csp').warn(
      '[internal] Collaboration endpoint excluded from CSP; use a credential-free DNS or IPv6 URL',
      { configuration: 'NEXT_PUBLIC_DOCUMENTS_COLLAB_URL' },
    )
    return []
  }
  return [url.origin]
}
