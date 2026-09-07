import type {
  SearchBuildContext,
  SearchIndexSource,
  SearchModuleConfig,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { DocumentContent } from './data/entities'
import { DOCUMENTS_ENTITY_IDS } from './lib/constants'

type ContainerLike = {
  resolve: (name: string) => unknown
}

function pickString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function isContainerLike(value: unknown): value is ContainerLike {
  return typeof value === 'object' && value !== null && 'resolve' in value && typeof value.resolve === 'function'
}

function isEntityManager(value: unknown): value is EntityManager {
  return typeof value === 'object' && value !== null && 'findOne' in value && typeof value.findOne === 'function'
}

function buildPresenter(t: TranslateFn, ctx: SearchBuildContext): SearchResultPresenter {
  return {
    // Search presenters must never surface opaque database identifiers as a
    // user-facing fallback. A missing/decrypted-away title remains a generic,
    // localized document label while the record id is used only for routing.
    title: pickString(ctx.record.title) ?? t('documents.search.badge.document', 'Document'),
    subtitle: pickString(ctx.record.folder_name, ctx.record.folderName) ?? undefined,
    icon: 'file-text',
    badge: t('documents.search.badge.document', 'Document'),
  }
}

async function resolveContentText(ctx: SearchBuildContext): Promise<string | null> {
  const direct = pickString(ctx.record.content_text, ctx.record.contentText)
  if (direct) return direct
  if (!isContainerLike(ctx.container) || typeof ctx.record.id !== 'string') return null
  // Both ownership predicates are mandatory. A build context missing either
  // scope value must refuse the read rather than widen it to a documentId-only
  // lookup that would cross tenant/organization boundaries.
  const tenantId = pickString(ctx.tenantId)
  const organizationId = pickString(ctx.organizationId)
  if (!tenantId || !organizationId) return null
  const em = ctx.container.resolve('em')
  if (!isEntityManager(em)) return null
  const content = await findOneWithDecryption(
    em,
    DocumentContent,
    {
      documentId: ctx.record.id,
      deletedAt: null,
      tenantId,
      organizationId,
    },
    { fields: ['contentText'] as const },
    { tenantId, organizationId },
  )
  return pickString(content?.contentText)
}

async function buildDocumentSource(ctx: SearchBuildContext): Promise<SearchIndexSource | null> {
  const { t } = await resolveTranslations()
  const title = pickString(ctx.record.title)
  const contentText = await resolveContentText(ctx)
  const text = [title, contentText].filter((value): value is string => Boolean(value))
  if (text.length === 0) return null
  return {
    text,
    presenter: buildPresenter(t, ctx),
    checksumSource: {
      record: ctx.record,
      contentText,
      customFields: ctx.customFields,
    },
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: DOCUMENTS_ENTITY_IDS.document,
      // Global cross-entity search is only feature-gated (search.view) with no per-record ACL
      // filter, so indexing per-document-private title/content here would expose them to any
      // org user holding documents.view — bypassing per-doc sharing. Disabled for M1; secure
      // per-doc-filtered document search is deferred until the search layer gains a per-record
      // visibility hook. In M1, documents are found via the permission-filtered list route
      // (/api/documents?search=). The reindex calls elsewhere safely no-op while this is off.
      enabled: false,
      priority: 9,
      fieldPolicy: {
        searchable: ['title', 'content_text'],
        excluded: ['yjs_state', 'content_html'],
      },
      buildSource: buildDocumentSource,
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildPresenter(t, ctx)
      },
      resolveUrl: async (ctx) => `/backend/documents/${encodeURIComponent(String(ctx.record.id))}`,
    },
  ],
}

export const config = searchConfig
export default searchConfig
