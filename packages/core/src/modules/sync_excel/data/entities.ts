import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core'

export type SyncExcelUploadStatus = 'uploaded' | 'previewed' | 'importing' | 'completed' | 'failed'

@Entity({ tableName: 'sync_excel_uploads' })
@Index({ properties: ['organizationId', 'tenantId', 'status'] })
export class SyncExcelUpload {
  [OptionalProps]?: 'delimiter' | 'encoding' | 'status' | 'syncRunId' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'attachment_id', type: 'uuid' })
  attachmentId!: string

  @Property({ name: 'filename', type: 'text' })
  filename!: string

  @Property({ name: 'mime_type', type: 'text' })
  mimeType!: string

  @Property({ name: 'file_size', type: 'int' })
  fileSize!: number

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'delimiter', type: 'text', nullable: true })
  delimiter?: string | null

  @Property({ name: 'encoding', type: 'text', nullable: true })
  encoding?: string | null

  @Property({ name: 'headers', type: 'json' })
  headers!: string[]

  @Property({ name: 'sample_rows', type: 'json' })
  sampleRows!: Array<Record<string, string | null>>

  @Property({ name: 'total_rows', type: 'int' })
  totalRows!: number

  @Property({ name: 'status', type: 'text', default: 'uploaded' })
  status: SyncExcelUploadStatus = 'uploaded'

  @Property({ name: 'sync_run_id', type: 'uuid', nullable: true })
  syncRunId?: string | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
