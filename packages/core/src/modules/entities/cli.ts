import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { CacheStrategy } from '@open-mercato/cache/types'
import { CustomEntity, CustomFieldDef, EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import {
  installCustomEntitiesFromModules,
  getAggregatedCustomEntityConfigs,
} from './lib/install-from-ce'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { DEFAULT_ENCRYPTION_MAPS } from '@open-mercato/core/modules/entities/lib/encryptionDefaults'

function parseArgs(rest: string[]) {
  const args: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (!a) continue
    if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=')
      if (v !== undefined) args[k] = v
      else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) { args[k] = rest[i + 1]!; i++ }
      else args[k] = true
    }
  }
  return args
}

const seedDefs: ModuleCli = {
  command: 'install',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantIdArg = (args.tenant as string) || (args.tenantId as string)
    const globalOnly = Boolean(args.global)
    const dry = Boolean(args['dry-run'] || args.dry)
    const force = Boolean(args.force)
    const includeGlobal = args['no-global'] ? false : true

    if (globalOnly && includeGlobal === false) {
      console.error('Cannot combine --global with --no-global.')
      return
    }

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    let cache: CacheStrategy | null = null
    try { cache = resolve('cache') as CacheStrategy } catch {}

    const tenantIds = tenantIdArg
      ? [tenantIdArg]
      : (globalOnly ? [] : undefined)

    const logger = (message: string) => {
      const prefix = dry ? '[dry-run] ' : ''
      console.log(`${prefix}${message}`)
    }

    const result = await installCustomEntitiesFromModules(em, cache, {
      tenantIds,
      includeGlobal,
      dryRun: dry,
      force,
      logger,
    })
    const label = dry ? 'Dry-run' : 'Sync'
    console.log(`✅ ${label} complete: processed=${result.processed}, updated=${result.synchronized}, fieldsChanged=${result.fieldChanges}, skipped=${result.skipped}`)
  },
}

// Reinstall: remove existing definitions for target scope and re-seed from modules
const reinstallDefs: ModuleCli = {
  command: 'reinstall',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantIdArg = (args.tenant as string) || (args.tenantId as string)
    const globalOnly = Boolean(args.global)
    const dry = Boolean(args['dry-run'] || args.dry)
    const includeGlobal = globalOnly ? true : (args['no-global'] ? false : true)

    if (globalOnly && includeGlobal === false) {
      console.error('Cannot combine --global with --no-global.')
      return
    }

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    let cache: CacheStrategy | null = null
    try { cache = resolve('cache') as CacheStrategy } catch {}

    const tenantIds = tenantIdArg
      ? [tenantIdArg]
      : (globalOnly ? [] : undefined)

    const aggregates = getAggregatedCustomEntityConfigs()
    const relevant = aggregates.filter((entry) => (globalOnly ? entry.spec?.global === true : true))
    if (!relevant.length) {
      console.log('No custom entities or fields discovered. Nothing to reinstall.')
      return
    }
    const entityIds = Array.from(new Set(relevant.map((entry) => entry.entityId)))
    if (!entityIds.length) {
      console.log('No entity ids discovered. Nothing to reinstall.')
      return
    }

    const logger = (message: string) => {
      const prefix = dry ? '[dry-run] ' : ''
      console.log(`${prefix}${message}`)
    }

    if (dry) {
      console.log('Dry-run: would remove existing custom entity definitions before reinstall.')
    } else {
      const fieldWhere: any = { entityId: { $in: entityIds } }
      if (tenantIds !== undefined) {
        if (tenantIds.length === 0) fieldWhere.tenantId = null
        else fieldWhere.tenantId = { $in: tenantIds }
      }
      const removedFields = await em.nativeDelete(CustomFieldDef, fieldWhere)

      const entityWhere: any = { entityId: { $in: entityIds } }
      if (tenantIds !== undefined) {
        if (tenantIds.length === 0) entityWhere.tenantId = null
        else entityWhere.tenantId = { $in: tenantIds }
      }
      const removedEntities = await em.nativeDelete(CustomEntity, entityWhere)

      if (cache && entityIds.length) {
        try {
          await cache.deleteByTags(entityIds.map((id) => `custom-entity:${id}`))
        } catch {}
      }
      console.log(`Cleared definitions: fields=${removedFields}, entities=${removedEntities}`)
    }

    const result = await installCustomEntitiesFromModules(em, cache, {
      tenantIds,
      includeGlobal,
      dryRun: dry,
      force: true,
      logger,
    })
    const label = dry ? 'Dry-run' : 'Reinstall'
    console.log(`✅ ${label} complete: processed=${result.processed}, updated=${result.synchronized}, fieldsChanged=${result.fieldChanges}, skipped=${result.skipped}`)
  },
}

// Interactive: add a single custom field definition
const addField: ModuleCli = {
  command: 'add-field',
  async run(rest) {
    const args = parseArgs(rest)
    const rl = readline.createInterface({ input, output })
    const ask = async (q: string, d?: string) => {
      const a = (await rl.question(d ? `${q} [${d}]: ` : `${q}: `)).trim()
      return a || (d ?? '')
    }
    const askBool = async (q: string, d = false) => {
      const a = (await ask(q, d ? 'y' : 'n')).toLowerCase()
      return a === 'y' || a === 'yes' || a === 'true'
    }

    try {
      const { resolve } = await createRequestContainer()
      const em = resolve('em') as any

      const entityId = (args.entity as string) || (args.e as string) || await ask('Entity ID (e.g., example:todo)')
      const isGlobal = args.global ? true : await askBool('Global (no organization)?', false)
      const orgId = isGlobal ? null : ((args.org as string) || (args.organizationId as string) || await ask('Organization ID'))
      const tenantId = isGlobal ? null : ((args.tenant as string) || (args.tenantId as string) || await ask('Tenant ID'))
      const key = (args.key as string) || await ask('Field key (snake_case)')
      let kind = (args.kind as string) || await ask("Kind (text|multiline|integer|float|boolean|select|relation|attachment)", 'text')
      kind = kind.toLowerCase()
      if (!['text','multiline','integer','float','boolean','select','relation','attachment'].includes(kind)) throw new Error('Invalid kind')
      const label = (args.label as string) || (await ask('Label', key))
      const description = (args.description as string) || ''
      const required = args.required !== undefined ? Boolean(args.required) : await askBool('Required?', false)
      const multi = args.multi !== undefined ? Boolean(args.multi) : await askBool('Allow multiple?', false)
      let options: string[] | undefined
      if (kind === 'select') {
        const raw = (args.options as string) || await ask('Options (comma-separated)', 'low,medium,high')
        options = raw.split(',').map((s) => s.trim()).filter(Boolean)
      }
      let defaultValue: any = undefined
      const defRaw = (args.default as string) ?? (args.defaultValue as string)
      const needDefault = defRaw !== undefined ? defRaw : await ask('Default value (leave empty for none)', '')
      if (needDefault !== '') {
        switch (kind) {
          case 'integer': defaultValue = Number(needDefault); break
          case 'float': defaultValue = Number(needDefault); break
          case 'boolean': defaultValue = ['y','yes','true','1'].includes(String(needDefault).toLowerCase()); break
          default: defaultValue = String(needDefault)
        }
      }
      const filterable = args.filterable !== undefined ? Boolean(args.filterable) : await askBool('Filterable?', true)
      const listVisible = args.listVisible !== undefined ? Boolean(args.listVisible) : await askBool('Visible in list?', true)
      const formEditable = args.formEditable !== undefined ? Boolean(args.formEditable) : await askBool('Editable in forms?', true)
      const indexed = args.indexed !== undefined ? Boolean(args.indexed) : await askBool('Indexed?', false)

      const where = { entityId, organizationId: orgId, tenantId: tenantId, key }
      const existing = await em.findOne(CustomFieldDef, where)
      const configJson: any = {}
      if (options) configJson.options = options
      if (defaultValue !== undefined) configJson.defaultValue = defaultValue
      if (required !== undefined) configJson.required = required
      if (multi !== undefined) configJson.multi = multi
      if (filterable !== undefined) configJson.filterable = filterable
      if (indexed !== undefined) configJson.indexed = indexed
      if (listVisible !== undefined) configJson.listVisible = listVisible
      if (formEditable !== undefined) configJson.formEditable = formEditable
      if (label !== undefined) configJson.label = label
      if (description !== undefined) configJson.description = description

      if (!existing) {
        await em.persistAndFlush(em.create(CustomFieldDef, {
          entityId,
          organizationId: orgId,
          tenantId: tenantId,
          key,
          kind,
          configJson,
          isActive: true,
        }))
        console.log(`Created custom field: ${entityId}.${key} (${kind})${orgId == null ? ' [global]' : ` [org=${orgId}, tenant=${tenantId}]`}`)
      } else {
        existing.kind = kind as any
        existing.configJson = configJson
        existing.isActive = true
        await em.flush()
        console.log(`Updated custom field: ${entityId}.${key} (${kind})${orgId == null ? ' [global]' : ` [org=${orgId}, tenant=${tenantId}]`}`)
      }
    } catch (e: any) {
      console.error('Failed:', e?.message || e)
    } finally {
      await rl.close()
    }
  },
}

async function upsertEncryptionMaps(em: any, tenantId: string, organizationId: string | null, logger: (msg: string) => void) {
  for (const spec of DEFAULT_ENCRYPTION_MAPS) {
    const existing = await em.findOne(EncryptionMap, {
      entityId: spec.entityId,
      tenantId,
      organizationId,
      deletedAt: null,
    })
    if (existing) {
      existing.fieldsJson = spec.fields
      existing.isActive = true
      existing.updatedAt = new Date()
      logger(`🔒 Updated encryption map for ${spec.entityId} ✨`)
      await em.persistAndFlush(existing)
      continue
    }
    const map = em.create(EncryptionMap, {
      entityId: spec.entityId,
      tenantId,
      organizationId,
      fieldsJson: spec.fields,
      isActive: true,
    })
    await em.persistAndFlush(map)
    logger(`Created encryption map for ${spec.entityId}`)
  }
}

const seedEncryptionMaps: ModuleCli = {
  command: 'seed-encryption',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = (args.tenant as string) || (args.tenantId as string)
    const organizationId = (args.org as string) || (args.organization as string) || (args.organizationId as string) || null

    if (!tenantId) {
      console.error('tenant id is required (use --tenant <uuid>)')
      return
    }
    if (!isTenantDataEncryptionEnabled()) {
      console.warn('TENANT_DATA_ENCRYPTION is disabled; skipping encryption map seeding.')
      return
    }

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    const logger = (msg: string) => console.log(msg)
    await upsertEncryptionMaps(em, tenantId, organizationId, logger)
    console.log('✅ Encryption maps seeded')
  },
}

// Keep default export stable (install first for help listing)
export default [seedDefs, reinstallDefs, addField, seedEncryptionMaps]
