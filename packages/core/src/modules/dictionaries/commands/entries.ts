import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import {
  dictionaryEntryCommandCreateSchema,
  dictionaryEntryCommandUpdateSchema,
} from '@open-mercato/core/modules/dictionaries/data/validators'
import {
  ensureDictionaryEntryScope,
  registerDictionaryEntryCommands,
} from '@open-mercato/core/modules/dictionaries/commands/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

async function ensureDictionary(em: EntityManager, id: string): Promise<Dictionary> {
  const dictionary = await em.findOne(Dictionary, {
    id,
    deletedAt: null,
  })
  if (!dictionary) {
    throw new CrudHttpError(404, { error: 'Dictionary not found' })
  }
  return dictionary
}

registerDictionaryEntryCommands({
  commandPrefix: 'dictionaries.entries',
  resourceKind: 'dictionaries.entry',
  translationKeyPrefix: 'dictionaries.entries',
  createSchema: dictionaryEntryCommandCreateSchema,
  updateSchema: dictionaryEntryCommandUpdateSchema,
  ensureScope: ensureDictionaryEntryScope,
  duplicateError: 'An entry with this value already exists.',
  resolveDictionaryForCreate: async ({ em, ctx, parsed }) => {
    const dictionary = await ensureDictionary(em, parsed.dictionaryId)
    const scope = { tenantId: dictionary.tenantId, organizationId: dictionary.organizationId }
    ensureDictionaryEntryScope(ctx, scope)
    return { dictionary, scope }
  },
  resolveEntry: async ({ em, ctx, id }) => {
    const entry = await findOneWithDecryption(em, DictionaryEntry, id, { populate: ['dictionary'] })
    if (!entry) {
      throw new CrudHttpError(404, { error: 'Dictionary entry not found' })
    }
    if (entry.dictionary.deletedAt) {
      throw new CrudHttpError(404, { error: 'Dictionary not found' })
    }
    const scope = { tenantId: entry.tenantId, organizationId: entry.organizationId }
    ensureDictionaryEntryScope(ctx, scope)
    return { entry, dictionary: entry.dictionary, scope }
  },
  ensureDictionaryForUndo: async ({ em, snapshot }) => {
    return em.findOne(Dictionary, snapshot.dictionaryId, { filters: false })
  },
})
