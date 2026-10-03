import type { EntityManager } from '@mikro-orm/postgresql'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { GeneratedDocument } from '../../data/entities'
import type { ListDocumentsQuery } from '../../data/validators'

export const GENERATED_DOCUMENT_ENTITY_ID = 'document_generators:generated_document'
const ENCRYPTED_LABEL_FIELD = 'resource_label'

export type GeneratedDocumentDto = {
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

export type GenerationHistoryScope = {
  tenantId: string
  organizationId: string
}

export type RecordGeneratedDocumentInput = GenerationHistoryScope & {
  resourceKind: string
  resourceId: string
  resourceLabel?: string | null
  templateId: string
  templateLabel: string
  format: string
  mimeType: string
  generatedBy: string
  generatedAt: Date
}

export type PreparedGeneratedDocument = {
  entity: GeneratedDocument
  plaintextResourceLabel: string
}

export type GenerationHistoryPage = {
  items: GeneratedDocumentDto[]
  total: number
  page: number
  pageSize: number
}

const SORT_PROPERTY_BY_FIELD = {
  template_label: 'templateLabel',
  format: 'format',
  generated_by: 'generatedBy',
  generated_at: 'generatedAt',
} as const

export function toGeneratedDocumentDto(entity: GeneratedDocument): GeneratedDocumentDto {
  return {
    id: entity.id,
    resourceKind: entity.resourceKind,
    resourceId: entity.resourceId,
    resourceLabel: entity.resourceLabel,
    templateId: entity.templateId,
    templateLabel: entity.templateLabel,
    format: entity.format,
    generatedBy: entity.generatedBy,
    generatedAt: entity.generatedAt.toISOString(),
  }
}

export class GenerationHistoryService {
  constructor(private readonly em: EntityManager) {}

  async prepare(input: RecordGeneratedDocumentInput): Promise<PreparedGeneratedDocument> {
    const trimmedLabel = typeof input.resourceLabel === 'string' ? input.resourceLabel.trim() : ''
    const plaintextResourceLabel = trimmedLabel.length > 0 ? trimmedLabel : input.resourceId
    const sealedLabel = await this.sealResourceLabel(plaintextResourceLabel, input)

    const entity = new GeneratedDocument()
    entity.tenantId = input.tenantId
    entity.organizationId = input.organizationId
    entity.resourceKind = input.resourceKind
    entity.resourceId = input.resourceId
    entity.resourceLabel = sealedLabel
    entity.templateId = input.templateId
    entity.templateLabel = input.templateLabel
    entity.format = input.format
    entity.mimeType = input.mimeType
    entity.generatedBy = input.generatedBy
    entity.generatedAt = input.generatedAt
    entity.attachmentId = null
    return { entity, plaintextResourceLabel }
  }

  async persist(prepared: PreparedGeneratedDocument): Promise<GeneratedDocumentDto> {
    const writeEm = this.em.fork()
    writeEm.persist(prepared.entity)
    await writeEm.flush()
    return toGeneratedDocumentDto({
      ...prepared.entity,
      resourceLabel: prepared.plaintextResourceLabel,
    } as GeneratedDocument)
  }

  async listAndCount(scope: GenerationHistoryScope, query: ListDocumentsQuery): Promise<GenerationHistoryPage> {
    const where: Record<string, unknown> = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
    if (query.resource_kind) where.resourceKind = query.resource_kind
    if (query.resource_id) where.resourceId = query.resource_id
    if (query.template_id) where.templateId = query.template_id
    if (query.generated_by) where.generatedBy = query.generated_by
    const generatedAtRange: Record<string, Date> = {}
    if (query.generated_from) generatedAtRange.$gte = new Date(query.generated_from)
    if (query.generated_to) generatedAtRange.$lte = new Date(query.generated_to)
    if (Object.keys(generatedAtRange).length > 0) where.generatedAt = generatedAtRange

    const sortProperty = SORT_PROPERTY_BY_FIELD[query.sort ?? 'generated_at']
    const direction = query.sort_direction === 'asc' ? 'asc' : 'desc'
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20

    const [records, total] = await findAndCountWithDecryption(
      this.em,
      GeneratedDocument,
      where,
      {
        orderBy: [{ [sortProperty]: direction }, { id: direction }],
        limit: pageSize,
        offset: (page - 1) * pageSize,
      },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    return { items: records.map(toGeneratedDocumentDto), total, page, pageSize }
  }

  private async sealResourceLabel(label: string, scope: GenerationHistoryScope): Promise<string> {
    if (!isTenantDataEncryptionEnabled()) return label
    const service = resolveTenantEncryptionService(this.em)
    if (!service || !service.isEnabled()) {
      throw new Error('[internal] generation history encryption unavailable; refusing to persist plaintext resource label')
    }
    const encryptedFields = await service.getEncryptedFieldNames(
      GENERATED_DOCUMENT_ENTITY_ID,
      scope.tenantId,
      scope.organizationId,
    )
    if (!encryptedFields.includes(ENCRYPTED_LABEL_FIELD)) return label
    const sealed = await service.encryptEntityPayload(
      GENERATED_DOCUMENT_ENTITY_ID,
      { [ENCRYPTED_LABEL_FIELD]: label },
      scope.tenantId,
      scope.organizationId,
    )
    const sealedLabel = sealed[ENCRYPTED_LABEL_FIELD]
    if (typeof sealedLabel !== 'string' || sealedLabel === label) {
      throw new Error('[internal] generation history encryption produced no ciphertext; refusing to persist plaintext resource label')
    }
    return sealedLabel
  }
}
