/** Organization + tenant pair every history operation is scoped to. */
export interface HistoryScope {
  organizationId: string
  tenantId: string
}

/** Input for persisting a single generation-history row. */
export interface CreateGeneratedDocumentInput {
  scope: HistoryScope
  templateId: string
  templateLabel: string
  resourceKind: string
  resourceId: string
  resourceLabel: string
  generatedBy: string
  format: string
  mimeType: string
}

/** Input for a paginated history read. */
export interface ListGeneratedDocumentsQuery {
  scope: HistoryScope
  page: number
  pageSize: number
  resourceKind?: string
  resourceId?: string
}

/** Serialized history row returned to API callers (dates as ISO strings). */
export interface GeneratedDocumentDto {
  id: string
  resourceKind: string
  resourceId: string
  resourceLabel: string
  templateId: string
  templateLabel: string
  format: string
  generatedBy: string
  generatedAt: string
}
