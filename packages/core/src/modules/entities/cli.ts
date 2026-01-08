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
import { createKmsService, type KmsService, type TenantDek } from '@open-mercato/shared/lib/encryption/kms'
import { decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { resolveEntityIdFromMetadata } from '@open-mercato/shared/lib/encryption/entityIds'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import crypto from 'node:crypto'

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

function normalizeKeyInput(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '')
}

class DerivedKeyKmsService implements KmsService {
  private root: Buffer
  constructor(secret: string) {
    this.root = crypto.createHash('sha256').update(normalizeKeyInput(secret)).digest()
  }

  isHealthy(): boolean {
    return true
  }

  private deriveKey(tenantId: string): string {
    const iterations = 310_000
    const keyLength = 32
    const derived = crypto.pbkdf2Sync(this.root, tenantId, iterations, keyLength, 'sha512')
    return derived.toString('base64')
  }

  async getTenantDek(tenantId: string): Promise<TenantDek | null> {
    if (!tenantId) return null
    return { tenantId, key: this.deriveKey(tenantId), fetchedAt: Date.now() }
  }

  async createTenantDek(tenantId: string): Promise<TenantDek | null> {
    return this.getTenantDek(tenantId)
  }
}

function fingerprintDek(dek: TenantDek | null): string | null {
  if (!dek?.key) return null
  return crypto.createHash('sha256').update(dek.key).digest('hex').slice(0, 12)
}

function decryptWithOldKey(
  payload: string,
  dek: TenantDek | null,
): string | null {
  if (!dek?.key) return null
  return decryptWithAesGcm(payload, dek.key)
}

const rotateEncryptionKey: ModuleCli = {
  command: 'rotate-encryption-key',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantIdArg = (args.tenant as string) || (args.tenantId as string) || null
    const organizationIdArg = (args.org as string) || (args.organization as string) || (args.organizationId as string) || null
    const oldKey = (args['old-key'] as string) || (args.oldKey as string) || null
    const dryRun = Boolean(args['dry-run'] || args.dry)
    const debug = Boolean(args.debug)
    const rotate = Boolean(oldKey)
    if (rotate && !tenantIdArg) {
      console.warn(
        '⚠️  Rotating with --old-key across all tenants. A single old key should normally target one tenant; consider --tenant.',
      )
    }
    if (!isTenantDataEncryptionEnabled()) {
      console.error('TENANT_DATA_ENCRYPTION is disabled; aborting.')
      return
    }

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    const conn: any = em?.getConnection?.()
    if (!conn || typeof conn.execute !== 'function') {
      console.error('Unable to access raw connection; aborting.')
      return
    }

    const encryptionService = new TenantDataEncryptionService(em as any, { kms: createKmsService() })
    const oldKms = rotate && oldKey ? new DerivedKeyKmsService(oldKey) : null
    if (!encryptionService.isEnabled()) {
      console.error('Encryption service is not enabled (KMS unhealthy or no DEK). Aborting.')
      return
    }

    if (debug) {
      console.log('[rotate-encryption-key]', {
        hasOldKey: Boolean(oldKey),
        rotate,
        tenantId: tenantIdArg ?? null,
        organizationId: organizationIdArg ?? null,
      })
      if (tenantIdArg) {
        const [oldDek, newDek] = await Promise.all([
          oldKms?.getTenantDek(tenantIdArg) ?? Promise.resolve(null),
          encryptionService.getDek(tenantIdArg),
        ])
        console.log('[rotate-encryption-key] dek fingerprints', {
          oldKey: fingerprintDek(oldDek),
          currentKey: fingerprintDek(newDek),
        })
      } else {
        console.log('[rotate-encryption-key] dek fingerprints skipped (no tenantId)')
      }
    }

    const isEncryptedPayload = (value: unknown): boolean => {
      if (typeof value !== 'string') return false
      const parts = value.split(':')
      return parts.length === 4 && parts[3] === 'v1'
    }

    const registry = em?.getMetadata?.()
    const allMetaRaw = typeof registry?.getAll === 'function' ? registry.getAll() : []
    const allMeta = Array.isArray(allMetaRaw) ? allMetaRaw : Object.values(allMetaRaw ?? {})
    const metaByEntityId = new Map<string, any>()
    for (const meta of allMeta) {
      const resolved = resolveEntityIdFromMetadata(meta)
      if (resolved) metaByEntityId.set(resolved, meta)
    }

    const where: any = { deletedAt: null }
    if (tenantIdArg) where.tenantId = tenantIdArg
    if (organizationIdArg) where.organizationId = organizationIdArg
    const maps = await em.find(EncryptionMap, where)
    if (!maps.length) {
      console.log('No encryption maps found for the selected scope.')
      return
    }

    const resolveProperty = (meta: any, field: string): { columnName: string | null; prop: any | null } => {
      if (!meta?.properties) return { columnName: null, prop: null }
      const candidates = [
        field,
        field.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        field.replace(/([A-Z])/g, '_$1').toLowerCase(),
      ]
      for (const candidate of candidates) {
        const prop = meta.properties[candidate]
        const fieldName =
          prop?.fieldName ??
          (Array.isArray(prop?.fieldNames) && prop.fieldNames.length ? prop.fieldNames[0] : undefined)
        if (typeof fieldName === 'string' && fieldName.length) return { columnName: fieldName, prop }
        if (prop?.name) return { columnName: prop.name, prop }
      }
      return { columnName: null, prop: null }
    }

    const formatValueForColumn = (prop: any, value: unknown): unknown => {
      if (value === null || value === undefined) return value
      const types = Array.isArray(prop?.columnTypes) ? prop.columnTypes : []
      const type = String(prop?.type ?? '').toLowerCase()
      const isJson = types.some((entry: string) => entry.toLowerCase().includes('json')) || type === 'json' || type === 'jsonb'
      if (!isJson) return value
      return JSON.stringify(value)
    }

    const resolveScopes = async (tenantId: string, organizationId: string | null) => {
      if (organizationId) return [{ tenantId, organizationId }]
      const orgs = await em.find(Organization, { tenantId })
      const scopes = orgs.map((org: Organization) => ({
        tenantId,
        organizationId: String(org.id),
      }))
      scopes.push({ tenantId, organizationId: null })
      return scopes
    }

    const oldDekCache = new Map<string, TenantDek | null>()
    const processScope = async (
      entityId: string,
      meta: any,
      fields: Array<{ field: string; hashField?: string | null }>,
      scope: { tenantId: string; organizationId: string | null },
    ): Promise<number> => {
      const pk = Array.isArray(meta?.primaryKeys) && meta.primaryKeys.length ? meta.primaryKeys[0] : 'id'
      const columns = new Set<string>()
      columns.add(pk)
      for (const rule of fields) {
        const resolved = resolveProperty(meta, rule.field)
        if (resolved?.columnName) columns.add(resolved.columnName)
        if (rule.hashField) {
          const resolvedHash = resolveProperty(meta, rule.hashField)
          if (resolvedHash?.columnName) columns.add(resolvedHash.columnName)
        }
      }
      const columnList = Array.from(columns)
      if (!columnList.length) return 0
      const tableName = meta?.tableName
      if (!tableName) return 0
      const schema = meta?.schema
      const qualifiedTable = schema ? `"${schema}"."${tableName}"` : `"${tableName}"`
      const selectSql = `select ${columnList.map((c) => `"${c}"`).join(', ')} from ${qualifiedTable} where tenant_id = ? and organization_id is not distinct from ?`
      const rows = await conn.execute(selectSql, [scope.tenantId, scope.organizationId])
      const list = Array.isArray(rows) ? rows : []
      if (!list.length) return 0
      let updated = 0
      for (const row of list) {
        const payload: Record<string, unknown> = {}
        for (const rule of fields) {
          const resolved = resolveProperty(meta, rule.field)
          const col = resolved?.columnName
          if (!col) continue
          const rawValue = row[col]
          if (rotate && !isEncryptedPayload(rawValue)) {
            continue
          }
          payload[rule.field] = rawValue
          if (rule.hashField) {
            const resolvedHash = resolveProperty(meta, rule.hashField)
            const hashCol = resolvedHash?.columnName
            if (hashCol) payload[rule.hashField] = row[hashCol]
          }
        }
        if (rotate && !Object.keys(payload).length) {
          continue
        }
        if (rotate && oldKms) {
          let oldDek = oldDekCache.get(scope.tenantId) ?? null
          if (!oldDekCache.has(scope.tenantId)) {
            oldDek = await oldKms.getTenantDek(scope.tenantId)
            oldDekCache.set(scope.tenantId, oldDek)
          }
          for (const rule of fields) {
            const value = payload[rule.field]
            if (typeof value !== 'string' || !isEncryptedPayload(value)) continue
            const decrypted = decryptWithOldKey(value, oldDek)
            if (decrypted === null) continue
            try {
              payload[rule.field] = JSON.parse(decrypted)
            } catch {
              payload[rule.field] = decrypted
            }
          }
        }
        const encrypted = await encryptionService.encryptEntityPayload(
          entityId,
          payload,
          scope.tenantId,
          scope.organizationId,
        )
        const updates: Record<string, unknown> = {}
        for (const rule of fields) {
          const resolved = resolveProperty(meta, rule.field)
          const col = resolved?.columnName
          if (!col) continue
          const nextValue = (encrypted as any)[rule.field]
          if (nextValue !== undefined && nextValue !== row[col]) {
            if (!rotate && isEncryptedPayload(row[col])) continue
            updates[col] = formatValueForColumn(resolved?.prop, nextValue)
          }
          if (rule.hashField) {
            const resolvedHash = resolveProperty(meta, rule.hashField)
            const hashCol = resolvedHash?.columnName
            const hashValue = (encrypted as any)[rule.hashField]
            if (hashCol && hashValue !== undefined && hashValue !== row[hashCol]) {
              updates[hashCol] = formatValueForColumn(resolvedHash?.prop, hashValue)
            }
          }
        }
        if (!Object.keys(updates).length) continue
        if (!dryRun) {
          const setSql = Object.keys(updates).map((col) => `"${col}" = ?`).join(', ')
          await conn.execute(
            `update ${qualifiedTable} set ${setSql} where "${pk}" = ?`,
            [...Object.values(updates), row[pk]],
          )
        }
        updated += 1
      }
      return updated
    }

    let total = 0
    for (const map of maps) {
      const entityId = String(map.entityId)
      const meta = metaByEntityId.get(entityId)
      if (!meta) {
        console.warn(`Skipping ${entityId}: metadata not found.`)
        continue
      }
      const fields = Array.isArray(map.fieldsJson) ? map.fieldsJson : []
      if (!fields.length) continue
      const tenantId = map.tenantId ? String(map.tenantId) : null
      if (!tenantId) continue
      const scopes = await resolveScopes(tenantId, map.organizationId ? String(map.organizationId) : null)
      for (const scope of scopes) {
        const updated = await processScope(entityId, meta, fields, scope)
        if (updated > 0) {
          console.log(
            `${dryRun ? '[dry-run] ' : ''}Encrypted ${updated} record(s) for ${entityId} org=${scope.organizationId ?? 'null'}`
          )
        }
        total += updated
      }
    }

    if (total > 0) {
      console.log(`Encrypted ${total} record(s) across mapped entities.`)
    } else {
      console.log('All mapped entity fields already encrypted for the selected scope.')
    }
  },
}

// Keep default export stable (install first for help listing)
export default [seedDefs, reinstallDefs, addField, seedEncryptionMaps, rotateEncryptionKey]
