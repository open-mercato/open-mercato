import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

export const API_DOCS_VIEW_FEATURE = 'api_docs.view'

export function isApiDocsPubliclyAvailable(): boolean {
  return parseBooleanWithDefault(process.env.OM_API_DOCS_PUBLICLY_AVAILABLE, false)
}

export function getApiDocsExportRouteGetMetadata(): {
  requireAuth: boolean
  requireFeatures?: string[]
} {
  if (isApiDocsPubliclyAvailable()) {
    return { requireAuth: false }
  }
  return { requireAuth: true, requireFeatures: [API_DOCS_VIEW_FEATURE] }
}

export function getApiDocsPageMetadataAuth(): {
  requireAuth: boolean
  requireFeatures?: readonly string[]
} {
  if (isApiDocsPubliclyAvailable()) {
    return { requireAuth: false }
  }
  return { requireAuth: true, requireFeatures: [API_DOCS_VIEW_FEATURE] as const }
}
