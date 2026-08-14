import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { GeneratedDocument } from '../../data/entities'
import type {
  CreateGeneratedDocumentInput,
  GeneratedDocumentDto,
  ListGeneratedDocumentsQuery,
} from './types'

/**
 * Owns all persistence and read logic for {@link GeneratedDocument} history rows.
 *
 * Instantiated per request with the request-scoped `em` (plain `new`, no DI —
 * consistent with the module's other services). Keeps the API routes thin: they
 * only translate HTTP ↔ service calls.
 */
export class GenerationHistoryService {
  constructor(private readonly em: EntityManager) {}

  /** Persists and returns one generated-document history row. */
  async create(input: CreateGeneratedDocumentInput): Promise<GeneratedDocument> {
    const doc = this.em.create(GeneratedDocument, {
      organizationId: input.scope.organizationId,
      tenantId: input.scope.tenantId,
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      resourceLabel: input.resourceLabel,
      templateId: input.templateId,
      templateLabel: input.templateLabel,
      format: input.format,
      mimeType: input.mimeType,
      generatedBy: input.generatedBy,
    })
    this.em.persist(doc)
    await this.em.flush()
    return doc
  }

  /**
   * Paginated history, newest first, scoped to the given organization + tenant.
   *
   * A plain ORM read (not `makeCrudRoute`): history rows are persisted directly
   * by `/generate`, so they never reach the query index a CRUD route would read.
   */
  async listAndCount(query: ListGeneratedDocumentsQuery): Promise<{ items: GeneratedDocumentDto[]; total: number }> {
    const generatedAt = {
      ...(query.generatedFrom ? { $gte: query.generatedFrom } : {}),
      ...(query.generatedTo ? { $lte: query.generatedTo } : {}),
    }
    const where: FilterQuery<GeneratedDocument> = {
      organizationId: query.scope.organizationId,
      tenantId: query.scope.tenantId,
      ...(query.resourceKind ? { resourceKind: query.resourceKind } : {}),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(query.templateId ? { templateId: query.templateId } : {}),
      ...(query.generatedBy ? { generatedBy: query.generatedBy } : {}),
      ...(query.generatedFrom || query.generatedTo ? { generatedAt } : {}),
    }
    const direction = query.sortDirection === 'asc' ? 'ASC' as const : 'DESC' as const
    const orderBy = (() => {
      switch (query.sortBy) {
        case 'resourceLabel': return { resourceLabel: direction }
        case 'templateLabel': return { templateLabel: direction }
        case 'format': return { format: direction }
        case 'generatedBy': return { generatedBy: direction }
        default: return { generatedAt: direction }
      }
    })()

    const [rows, total] = await this.em.findAndCount(GeneratedDocument, where, {
      orderBy,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    })

    const items = rows.map((d): GeneratedDocumentDto => ({
      id: d.id,
      resourceKind: d.resourceKind,
      resourceId: d.resourceId,
      resourceLabel: d.resourceLabel,
      templateId: d.templateId,
      templateLabel: d.templateLabel,
      format: d.format,
      generatedBy: d.generatedBy,
      generatedAt: d.generatedAt instanceof Date ? d.generatedAt.toISOString() : d.generatedAt,
    }))

    return { items, total }
  }
}
