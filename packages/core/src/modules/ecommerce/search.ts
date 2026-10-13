import type { SearchBuildContext, SearchIndexSource, SearchModuleConfig, SearchResultPresenter } from '@open-mercato/shared/modules/search'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const ECOMMERCE_STORE_CONFIG_URL = '/backend/config/ecommerce'

const STORE_STATUS_FALLBACKS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
}

function readText(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function translateStatus(translate: TranslateFn, status: string | null): string | null {
  if (!status) return null
  const fallback = STORE_STATUS_FALLBACKS[status] ?? status
  return translate(`ecommerce.search.status.${status}`, fallback)
}

function buildStorePresenter(
  translate: TranslateFn,
  record: Record<string, unknown>,
): SearchResultPresenter {
  const badge = translate('ecommerce.search.badge.store', 'Store')
  const name = readText(record, 'name')
  const code = readText(record, 'code')
  const slug = readText(record, 'slug')
  const title = name ?? code ?? slug ?? badge
  const subtitleParts = [code, slug, translateStatus(translate, readText(record, 'status'))].filter(
    (part): part is string => Boolean(part),
  )
  return {
    title,
    subtitle: subtitleParts.length ? subtitleParts.join(' · ') : undefined,
    icon: 'store',
    badge,
  }
}

function buildStoreSource(
  ctx: SearchBuildContext,
  presenter: SearchResultPresenter,
): SearchIndexSource | null {
  const lines: string[] = []
  const name = readText(ctx.record, 'name')
  const code = readText(ctx.record, 'code')
  const slug = readText(ctx.record, 'slug')
  if (name) lines.push(`Name: ${name}`)
  if (code) lines.push(`Code: ${code}`)
  if (slug) lines.push(`Slug: ${slug}`)
  if (!lines.length) return null
  return {
    text: lines,
    presenter,
    checksumSource: { record: ctx.record, customFields: ctx.customFields },
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'ecommerce:ecommerce_store',
      aclFeatures: ['ecommerce.stores.view'],
      enabled: true,
      priority: 6,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildStoreSource(ctx, buildStorePresenter(translate, ctx.record))
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildStorePresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => {
        const id = readText(ctx.record, 'id')
        return id ? `${ECOMMERCE_STORE_CONFIG_URL}/${encodeURIComponent(id)}` : null
      },
      fieldPolicy: {
        searchable: ['name', 'code', 'slug'],
        excluded: ['settings'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
