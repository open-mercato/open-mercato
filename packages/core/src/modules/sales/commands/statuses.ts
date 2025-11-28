import { DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { registerDictionaryEntryCommands } from '@open-mercato/core/modules/dictionaries/commands/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  ensureSalesDictionary,
  getSalesDictionaryDefinition,
  type SalesDictionaryKind,
} from '../lib/dictionaries'
import {
  ensureOrganizationScope,
  ensureTenantScope,
} from './shared'
import {
  statusDictionaryCreateSchema,
  statusDictionaryUpdateSchema,
} from '../data/validators'

function ensureScope(ctx: Parameters<typeof ensureTenantScope>[0], scope: { tenantId: string; organizationId: string }): void {
  ensureTenantScope(ctx, scope.tenantId)
  ensureOrganizationScope(ctx, scope.organizationId)
}

function registerStatusDictionaryCommands(kind: SalesDictionaryKind): void {
  const definition = getSalesDictionaryDefinition(kind)

  registerDictionaryEntryCommands({
    commandPrefix: definition.commandPrefix,
    resourceKind: definition.resourceKind,
    translationKeyPrefix: definition.commandPrefix,
    createSchema: statusDictionaryCreateSchema,
    updateSchema: statusDictionaryUpdateSchema,
    ensureScope,
    duplicateError: 'Value already exists in this dictionary.',
    labels: {
      singular: definition.singular,
      create: `Create ${definition.singular}`,
      update: `Update ${definition.singular}`,
      delete: `Delete ${definition.singular}`,
    },
    resolveDictionaryForCreate: async ({ em, ctx, parsed }) => {
      const dictionary = await ensureSalesDictionary({
        em,
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        kind,
      })
      const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
      ensureScope(ctx, scope)
      return { dictionary, scope }
    },
    resolveEntry: async ({ em, ctx, id }) => {
      const entry = await em.findOne(DictionaryEntry, id, { populate: ['dictionary'] })
      if (!entry) {
        throw new CrudHttpError(404, { error: 'Dictionary entry not found' })
      }
      if (entry.dictionary.key !== definition.key) {
        throw new CrudHttpError(400, { error: 'Entry does not belong to this dictionary.' })
      }
      const scope = { tenantId: entry.tenantId, organizationId: entry.organizationId }
      ensureScope(ctx, scope)
      return { entry, dictionary: entry.dictionary, scope }
    },
    ensureDictionaryForUndo: async ({ em, snapshot }) => {
      return ensureSalesDictionary({
        em,
        tenantId: snapshot.tenantId,
        organizationId: snapshot.organizationId,
        kind,
      })
    },
  })
}

registerStatusDictionaryCommands('order-status')
registerStatusDictionaryCommands('order-line-status')
registerStatusDictionaryCommands('adjustment-kind')
