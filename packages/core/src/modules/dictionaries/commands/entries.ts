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
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, forbidden } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

function normalizeScopeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveSelectedOrganizationId(ctx: CommandRuntimeContext): string | null {
  return normalizeScopeId(ctx.selectedOrganizationId ?? ctx.organizationScope?.selectedId ?? null)
}

function resolveContextTenantId(ctx: CommandRuntimeContext): string | null {
  return normalizeScopeId(ctx.organizationScope?.tenantId ?? ctx.auth?.tenantId ?? null)
}

async function ensureDictionary(
  em: EntityManager,
  id: string,
  ctx: CommandRuntimeContext,
): Promise<Dictionary> {
  if (ctx.organizationScope?.selectionRejected) {
    throw forbidden()
  }
  const tenantId = resolveContextTenantId(ctx)
  const organizationId = resolveSelectedOrganizationId(ctx)
  const dictionary = await em.findOne(Dictionary, {
    id,
    deletedAt: null,
    ...(tenantId ? { tenantId } : {}),
    ...(organizationId ? { organizationId } : {}),
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
    const dictionary = await ensureDictionary(em, parsed.dictionaryId, ctx)
    const scope = { tenantId: dictionary.tenantId, organizationId: dictionary.organizationId }
    ensureDictionaryEntryScope(ctx, scope)
    return { dictionary, scope }
  },
  resolveEntry: async ({ em, ctx, id }) => {
    if (ctx.organizationScope?.selectionRejected) {
      throw forbidden()
    }
    const entry = await findOneWithDecryption(em, DictionaryEntry, id, { populate: ['dictionary'] })
    if (!entry) {
      throw new CrudHttpError(404, { error: 'Dictionary entry not found' })
    }
    const tenantId = resolveContextTenantId(ctx)
    const selectedOrganizationId = resolveSelectedOrganizationId(ctx)
    if (
      (tenantId && entry.tenantId !== tenantId) ||
      (selectedOrganizationId && entry.organizationId !== selectedOrganizationId)
    ) {
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
