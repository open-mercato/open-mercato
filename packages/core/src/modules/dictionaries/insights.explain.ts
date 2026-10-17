import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { defineExplainConfig } from '@open-mercato/shared/modules/insights/explain'
import type { ExplainLoadContext, ExplainReferenceDetail } from '@open-mercato/shared/modules/insights/explain'
import {
  normalizeExplainIds,
  resolveExplainDecryptionScope,
  resolveExplainOrganizationWhere,
  runExplainResolverSafely,
} from '@open-mercato/shared/modules/insights/helpers'
import { DictionaryEntry } from './data/entities'

export const DICTIONARY_ENTRY_REFERENCE_KIND = 'dictionary.entry'

async function resolveDictionaryEntries(ctx: ExplainLoadContext, ids: string[]): Promise<ExplainReferenceDetail[]> {
  const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
  const entryIds = normalizeExplainIds(ids, { uuidOnly: true })
  if (!organizationWhere || entryIds.length === 0) return []
  const entries = await findWithDecryption(
    ctx.em,
    DictionaryEntry,
    { id: { $in: entryIds }, tenantId: ctx.scope.tenantId, ...organizationWhere },
    undefined,
    resolveExplainDecryptionScope(ctx.scope),
  )
  return entries.map((entry) => ({
    kind: DICTIONARY_ENTRY_REFERENCE_KIND,
    id: entry.id,
    label: entry.label,
    href: null,
    organizationId: entry.organizationId,
    facts: { value: entry.value, dictionaryId: entry.dictionary?.id ?? null },
  }))
}

export const explainConfig = defineExplainConfig({
  version: 1,
  referenceResolvers: [
    {
      kind: DICTIONARY_ENTRY_REFERENCE_KIND,
      requiredFeatures: ['dictionaries.view'],
      resolve: (ctx, ids) =>
        runExplainResolverSafely(
          { module: 'dictionaries', code: 'dictionaries.insights_reference_failed', kind: DICTIONARY_ENTRY_REFERENCE_KIND },
          () => resolveDictionaryEntries(ctx, ids),
        ),
    },
  ],
})

export default explainConfig
