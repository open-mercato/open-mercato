export type DocumentCategory = 'offer' | 'invoice' | 'customs' | 'bill_of_lading' | 'other'

export interface IFmsDocument {
  id: string
  organizationId: string
  tenantId: string
  name: string
  category?: DocumentCategory | null
  description?: string | null
  attachmentId: string
  relatedEntityId?: string | null
  relatedEntityType?: string | null
  extractedData?: Record<string, any> | null
  processedAt?: Date | null
  createdAt: Date
  createdBy?: string | null
  updatedAt: Date
  updatedBy?: string | null
  deletedAt?: Date | null
}

export interface FmsDocumentListItem {
  id: string
  name: string
  category?: DocumentCategory | null
  description?: string | null
  fileName?: string
  fileSize?: number
  createdAt: Date
  updatedAt: Date
}

export interface FmsDocumentCreateInput {
  organizationId: string
  tenantId: string
  name: string
  category?: DocumentCategory | null
  description?: string | null
  relatedEntityId?: string | null
  relatedEntityType?: string | null
  createdBy?: string | null
}

export interface FmsDocumentUpdateInput {
  name?: string
  category?: DocumentCategory | null
  description?: string | null
  relatedEntityId?: string | null
  relatedEntityType?: string | null
  updatedBy?: string | null
}
