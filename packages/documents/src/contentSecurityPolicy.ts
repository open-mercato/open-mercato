import { resolveDocumentsCollaborationEndpoint } from './modules/documents/lib/collabEndpoint'

export function resolveDocumentsCollaborationCspOrigins(): string[] {
  const endpoint = resolveDocumentsCollaborationEndpoint()
  if (!endpoint) return []
  const url = new URL(endpoint)
  if (url.username || url.password || !/^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])$/i.test(url.hostname)) return []
  return [url.origin]
}
