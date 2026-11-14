import type {
  SearchBuildContext,
  SearchIndexSource,
  SearchModuleConfig,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const ENTITY_ID = 'example:todo' as const

function pickString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function appendLine(lines: string[], label: string, value: unknown) {
  if (value === null || value === undefined) return
  const text = Array.isArray(value)
    ? value.map((entry) => (entry === null || entry === undefined ? '' : String(entry))).filter(Boolean).join(', ')
    : String(value)
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

function buildTodoPresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const title = pickString(record.title, customFields.title) ?? String(record.id ?? '')
  const isDone = record.is_done === true
  return {
    title,
    subtitle: isDone
      ? t('example.search.todo.subtitle.done', 'Completed')
      : t('example.search.todo.subtitle.open', 'Open'),
    icon: 'check-square',
  }
}

/**
 * Builds the text handed to the fuzzy/vector strategies.
 *
 * `notes` is deliberately absent. It is declared in `encryption.ts`, so it is
 * sensitive by definition and MUST NOT be shipped to an external embedding or
 * fulltext provider. It stays reachable through the `tokens` strategy instead:
 * `reindexSearchTokensForRecord` decrypts the index doc before tokenizing it, so
 * `search_tokens` holds hashes of the plaintext notes and matches them without
 * the plaintext ever leaving the database.
 */
function buildTodoSource(ctx: SearchBuildContext, presenter: SearchResultPresenter): SearchIndexSource | null {
  const lines: string[] = []
  appendLine(lines, 'Title', ctx.record.title ?? ctx.customFields.title)
  appendLine(lines, 'Labels', ctx.customFields.labels)
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
      entityId: ENTITY_ID,
      enabled: true,
      priority: 5,
      aclFeatures: ['example.todos.view'],
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildTodoSource(ctx, buildTodoPresenter(t, ctx.record, ctx.customFields))
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildTodoPresenter(t, ctx.record, ctx.customFields)
      },
      resolveUrl: (ctx) => `/backend/todos/${encodeURIComponent(String(ctx.record.id))}/edit`,
      fieldPolicy: {
        // `searchable` is a whitelist of fields safe to hand to an external
        // provider as plaintext.
        searchable: ['title'],
        // `notes` is encrypted at rest, so it is excluded rather than hash-only:
        // `hashOnly` advertises an approved hash sibling for exact-equality
        // lookup, and this module's encryption map declares no `hashField`.
        // Excluding it here costs nothing in reachability — `search_tokens` is
        // built by the query indexer from the DECRYPTED index doc and is not
        // gated by this policy, so token search over notes keeps working.
        excluded: ['notes'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
