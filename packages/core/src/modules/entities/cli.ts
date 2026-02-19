import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
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
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { createKmsService, type KmsService, type TenantDek } from '@open-mercato/shared/lib/encryption/kms'
import {
  decryptWithAesGcm,
  decryptWithAesGcmStrict,
  TenantDataEncryptionError,
  TenantDataEncryptionErrorCode,
} from '@open-mercato/shared/lib/encryption/aes'
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
      return parseBooleanToken(a) === true
    }

    try {
      const { resolve } = await createRequestContainer()
      const em = resolve('em') as any

      const entityId = (args.entity as string) || (args.e as string) || await ask('Entity ID (e.g., example:todo)')
      const isGlobal = args.global ? true : await askBool('Global (no organization)?', false)
      const orgId = isGlobal ? null : ((args.org as string) || (args.organizationId as string) || await ask('Organization ID'))
      const tenantId = isGlobal ? null : ((args.tenant as string) || (args.tenantId as string) || await ask('Tenant ID'))
      const key = (args.key as string) || await ask('Field key (snake_case)')
      let kind = (args.kind as string) || await ask("Kind (text|multiline|integer|float|boolean|select|currency|relation|attachment)", 'text')
      kind = kind.toLowerCase()
      if (!['text','multiline','integer','float','boolean','select','currency','relation','attachment'].includes(kind)) throw new Error('Invalid kind')
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
          case 'boolean': defaultValue = parseBooleanToken(String(needDefault)) === true; break
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
      const orgs = await em.find(Organization, { tenant: tenantId })
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

const decryptDatabase: ModuleCli = {
  command: 'decrypt-database',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantIdArg = (args.tenant as string) || (args.tenantId as string) || null
    const organizationIdArg = (args.org as string) || (args.organization as string) || (args.organizationId as string) || null
    const entityIdArg = (args.entity as string) || null
    const checkMode = Boolean(args.check)
    const dryRun = Boolean(args['dry-run'] || args.dry) || checkMode
    const deactivateMaps = Boolean(args['deactivate-maps'])
    const confirm = (args.confirm as string) || null
    const batchSize = Math.max(1, parseInt(String(args['batch-size'] || args.batchSize || '500'), 10) || 500)
    const sleepMs = Math.max(0, parseInt(String(args['sleep-ms'] || args.sleepMs || '0'), 10) || 0)
    const debug = Boolean(args.debug)

    if (!tenantIdArg) {
      console.error('--tenant <uuid> is required.')
      return
    }

    if (!checkMode) {
      if (!confirm) {
        console.error('--confirm <tenantUuid> is required (safety gate). Pass the exact tenant UUID to confirm the operation.')
        return
      }
      if (confirm !== tenantIdArg) {
        console.error(`--confirm value "${confirm}" does not match --tenant "${tenantIdArg}". Aborting.`)
        return
      }
    }

    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    const conn: any = em?.getConnection?.()
    if (!conn || typeof conn.execute !== 'function') {
      console.error('Unable to access raw database connection; aborting.')
      return
    }

    if (!checkMode && !isTenantDataEncryptionEnabled()) {
      console.error('TENANT_DATA_ENCRYPTION is disabled; aborting. Data may already be decrypted.')
      return
    }

    const registry = em?.getMetadata?.()
    const allMetaRaw = typeof registry?.getAll === 'function' ? registry.getAll() : []
    const allMeta = Array.isArray(allMetaRaw) ? allMetaRaw : Object.values(allMetaRaw ?? {})
    const metaByEntityId = new Map<string, any>()
    for (const meta of allMeta) {
      const resolved = resolveEntityIdFromMetadata(meta)
      if (resolved) metaByEntityId.set(resolved, meta)
    }

    const resolvePropertyDecrypt = (meta: any, field: string): { columnName: string | null; prop: any | null } => {
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

    const resolveDecryptScopes = async (
      tenantId: string,
      organizationId: string | null,
    ): Promise<Array<{ tenantId: string; organizationId: string | null }>> => {
      if (organizationId) return [{ tenantId, organizationId }]
      const rows = await conn.execute(
        `SELECT DISTINCT organization_id FROM encryption_maps WHERE tenant_id = ? AND deleted_at IS NULL`,
        [tenantId],
      )
      const orgIds = new Set<string | null>()
      for (const row of Array.isArray(rows) ? rows : []) {
        orgIds.add(row.organization_id ?? null)
      }
      orgIds.add(null)
      return Array.from(orgIds).map((orgId) => ({ tenantId, organizationId: orgId }))
    }

    const mapWhere: any = { tenantId: tenantIdArg, deletedAt: null, isActive: true }
    if (organizationIdArg) mapWhere.organizationId = organizationIdArg
    if (entityIdArg) mapWhere.entityId = entityIdArg
    const maps = await em.find(EncryptionMap, mapWhere)

    if (!maps.length) {
      console.log('No active encryption maps found for the selected scope.')
      return
    }

    const kms = createKmsService()
    const dekCache = new Map<string, TenantDek | null>()
    const getDek = async (tenantId: string): Promise<TenantDek | null> => {
      if (dekCache.has(tenantId)) return dekCache.get(tenantId) ?? null
      const dek = await kms.getTenantDek(tenantId)
      dekCache.set(tenantId, dek)
      return dek
    }

    if (checkMode) {
      const envValue = process.env.TENANT_DATA_ENCRYPTION ?? '(not set)'
      console.log(`TENANT_DATA_ENCRYPTION = ${envValue}`)
      console.log(`Active EncryptionMap records for scope: ${maps.length}`)
      let encryptedCandidatesSampled = 0
      let malformedPayloadCountSampled = 0
      for (const map of maps) {
        const entityId = String(map.entityId)
        const meta = metaByEntityId.get(entityId)
        if (!meta) continue
        const fields = Array.isArray(map.fieldsJson) ? map.fieldsJson : []
        if (!fields.length) continue
        const tenantId = map.tenantId ? String(map.tenantId) : null
        if (!tenantId) continue
        const dek = await getDek(tenantId).catch(() => null)
        if (!dek) continue
        const scopes = await resolveDecryptScopes(tenantId, map.organizationId ? String(map.organizationId) : null)
        const pk = Array.isArray(meta?.primaryKeys) && meta.primaryKeys.length ? meta.primaryKeys[0] : 'id'
        const tableName = meta?.tableName
        if (!tableName) continue
        const schema = meta?.schema
        const qualifiedTable = schema ? `"${schema}"."${tableName}"` : `"${tableName}"`
        const fieldCols = fields.flatMap((f: any) => {
          const r = resolvePropertyDecrypt(meta, f.field)
          return r.columnName ? [r.columnName] : []
        })
        const colList = Array.from(new Set([pk, ...fieldCols]))
        for (const scope of scopes) {
          const sampleRows = await conn.execute(
            `SELECT ${colList.map((c: string) => `"${c}"`).join(', ')} FROM ${qualifiedTable} WHERE tenant_id = ? AND organization_id IS NOT DISTINCT FROM ? LIMIT 100`,
            [scope.tenantId, scope.organizationId],
          ).catch(() => [])
          for (const row of Array.isArray(sampleRows) ? sampleRows : []) {
            let rowHasEncrypted = false
            for (const fieldRule of fields) {
              const resolved = resolvePropertyDecrypt(meta, fieldRule.field)
              const col = resolved?.columnName
              if (!col) continue
              const rawValue = row[col]
              if (rawValue === null || rawValue === undefined) continue
              try {
                decryptWithAesGcmStrict(String(rawValue), dek.key)
                rowHasEncrypted = true
              } catch (e: any) {
                if (e instanceof TenantDataEncryptionError && e.code === TenantDataEncryptionErrorCode.MALFORMED_PAYLOAD) {
                  malformedPayloadCountSampled++
                }
              }
            }
            if (rowHasEncrypted) encryptedCandidatesSampled++
          }
        }
      }
      console.log(`estimated encrypted candidates (sampled): ${encryptedCandidatesSampled}`)
      if (malformedPayloadCountSampled > 0) {
        console.warn(`⚠ malformed payloads (sampled): ${malformedPayloadCountSampled} — may indicate corruption`)
      } else {
        console.log(`malformed payloads (sampled): ${malformedPayloadCountSampled}`)
      }
      console.log('not a proof of absence — run full command + rerun --check to confirm')
      return
    }

    let totalRowsFetched = 0
    let totalRowsUpdated = 0
    let totalHashFieldsCleared = 0
    const totalHashFieldsSkipped = new Set<string>()
    let totalMalformedPayloadCount = 0
    const malformedByLocation = new Map<string, number>()
    let totalEntitiesProcessed = 0

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
      const dek = await getDek(tenantId)
      if (!dek) {
        console.warn(`No DEK available for tenant ${tenantId}; skipping ${entityId}.`)
        continue
      }
      const pk = Array.isArray(meta?.primaryKeys) && meta.primaryKeys.length ? meta.primaryKeys[0] : 'id'
      const tableName = meta?.tableName
      if (!tableName) {
        console.warn(`Skipping ${entityId}: table name not found.`)
        continue
      }
      const schema = meta?.schema
      const qualifiedTable = schema ? `"${schema}"."${tableName}"` : `"${tableName}"`
      const fieldCols = fields.flatMap((f: any) => {
        const r = resolvePropertyDecrypt(meta, f.field)
        return r.columnName ? [r.columnName] : []
      })
      const colList = Array.from(new Set([pk, ...fieldCols]))
      totalEntitiesProcessed++

      const scopes = await resolveDecryptScopes(tenantId, map.organizationId ? String(map.organizationId) : null)

      for (const scope of scopes) {
        let lastId: string | null = null
        let scopeMalformedCount = 0

        while (true) {
          let selectSql = `SELECT ${colList.map((c: string) => `"${c}"`).join(', ')} FROM ${qualifiedTable} WHERE tenant_id = ? AND organization_id IS NOT DISTINCT FROM ?`
          const selectParams: unknown[] = [scope.tenantId, scope.organizationId]
          if (lastId !== null) {
            selectSql += ` AND "${pk}" > ?`
            selectParams.push(lastId)
          }
          selectSql += ` ORDER BY "${pk}" LIMIT ?`
          selectParams.push(batchSize)

          const batchRows = await conn.execute(selectSql, selectParams)
          const batch = Array.isArray(batchRows) ? batchRows : []
          if (!batch.length) break

          lastId = String(batch[batch.length - 1]![pk])
          totalRowsFetched += batch.length

          const batchStart = Date.now()
          await conn.execute('BEGIN')
          let batchCommitted = false
          try {
            for (const row of batch) {
              const updates: Record<string, unknown> = {}
              let rowDecrypted = false

              for (const fieldRule of fields) {
                const resolved = resolvePropertyDecrypt(meta, fieldRule.field)
                const col = resolved?.columnName
                if (!col) continue
                const rawValue = row[col]
                if (rawValue === null || rawValue === undefined) continue
                try {
                  const decrypted = decryptWithAesGcmStrict(String(rawValue), dek.key)
                  let valueToWrite: string
                  try {
                    const parsed = JSON.parse(decrypted)
                    valueToWrite = typeof parsed === 'string' ? parsed : decrypted
                  } catch {
                    valueToWrite = decrypted
                  }
                  updates[col] = valueToWrite
                  rowDecrypted = true
                } catch (e: any) {
                  if (e instanceof TenantDataEncryptionError) {
                    if (e.code === TenantDataEncryptionErrorCode.AUTH_FAILED) {
                      // Value is plaintext — skip silently
                    } else if (e.code === TenantDataEncryptionErrorCode.MALFORMED_PAYLOAD) {
                      scopeMalformedCount++
                      const locationKey = `${tableName}:${col}`
                      malformedByLocation.set(locationKey, (malformedByLocation.get(locationKey) ?? 0) + 1)
                      console.warn(`⚠ MALFORMED_PAYLOAD for ${entityId} field "${col}" row ${row[pk]}; skipping field.`)
                    } else {
                      throw e
                    }
                  } else {
                    throw e
                  }
                }
              }

              if (rowDecrypted) {
                for (const fieldRule of fields) {
                  if (!fieldRule.hashField) continue
                  const resolvedHash = resolvePropertyDecrypt(meta, fieldRule.hashField)
                  const hashCol = resolvedHash?.columnName
                  if (!hashCol) {
                    const skippedKey = `${tableName}:${fieldRule.hashField}`
                    if (!totalHashFieldsSkipped.has(skippedKey)) {
                      console.warn(`⚠ Hash column "${fieldRule.hashField}" not found in metadata for ${entityId}; skipping.`)
                      totalHashFieldsSkipped.add(skippedKey)
                    }
                    continue
                  }
                  updates[hashCol] = null
                  totalHashFieldsCleared++
                }
              }

              if (Object.keys(updates).length > 0) {
                if (!dryRun) {
                  const setSql = Object.keys(updates).map((col) => `"${col}" = ?`).join(', ')
                  await conn.execute(
                    `UPDATE ${qualifiedTable} SET ${setSql} WHERE "${pk}" = ?`,
                    [...Object.values(updates), row[pk]],
                  )
                }
                totalRowsUpdated++
              }
            }
            await conn.execute('COMMIT')
            batchCommitted = true
          } catch (fatalErr: any) {
            if (!batchCommitted) {
              try { await conn.execute('ROLLBACK') } catch {}
            }
            console.error(`Fatal error during batch processing for ${entityId}: ${(fatalErr as Error)?.message || String(fatalErr)}`)
            throw fatalErr
          }

          const batchDurationMs = Date.now() - batchStart
          if (debug) {
            console.log(
              `[debug] Batch ${entityId} org=${scope.organizationId ?? 'null'}: ${batch.length} rows in ${batchDurationMs}ms, scopeMalformed=${scopeMalformedCount}`,
            )
            if (batchDurationMs > 30_000) {
              console.warn('⚠ Batch took >30s; consider reducing --batch-size.')
            }
          }
          if (sleepMs > 0) {
            await new Promise<void>((r) => setTimeout(r, sleepMs))
          }
        }

        totalMalformedPayloadCount += scopeMalformedCount
      }
    }

    if (deactivateMaps && !dryRun) {
      let deactivateSql = `UPDATE encryption_maps SET is_active = false, deleted_at = now() WHERE tenant_id = ? AND deleted_at IS NULL`
      const deactivateParams: unknown[] = [tenantIdArg]
      if (organizationIdArg) {
        deactivateSql += ` AND (organization_id = ? OR organization_id IS NULL)`
        deactivateParams.push(organizationIdArg)
      }
      if (entityIdArg) {
        deactivateSql += ` AND entity_id = ?`
        deactivateParams.push(entityIdArg)
      }
      await conn.execute(deactivateSql, deactivateParams)
      console.warn('⚠ Restart all application replicas — in-process map caches may still be active.')
      if (isTenantDataEncryptionEnabled()) {
        console.warn('⚠ Env TENANT_DATA_ENCRYPTION is still true — new writes will be re-encrypted until env is updated and replicas restarted.')
      }
    }

    if (deactivateMaps && dryRun) {
      console.log(`[dry-run] Would deactivate ${maps.length} EncryptionMap record(s).`)
    }

    const prefix = dryRun ? '[dry-run] ' : ''
    console.log(`\n${prefix}Decryption summary:`)
    console.log(`  Rows fetched:        ${totalRowsFetched}`)
    console.log(`  Rows updated:        ${totalRowsUpdated}`)
    console.log(`  Entities processed:  ${totalEntitiesProcessed}`)
    console.log(`  Hash fields cleared: ${totalHashFieldsCleared}`)
    if (totalHashFieldsSkipped.size > 0) {
      console.log(`  Hash fields skipped (missing columns): ${Array.from(totalHashFieldsSkipped).join(', ')}`)
    }
    if (totalMalformedPayloadCount > 0) {
      console.warn(
        `  ⚠ ${totalMalformedPayloadCount} field value(s) returned MALFORMED_PAYLOAD and were skipped; these may be corrupted ciphertexts. Investigate before assuming decryption is complete.`,
      )
      if (debug && malformedByLocation.size > 0) {
        const top = Array.from(malformedByLocation.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
        console.log('  Top malformed locations:')
        for (const [loc, count] of top) {
          console.log(`    ${loc}: ${count}`)
        }
      }
    }

    if (!dryRun) {
      console.log(`\n✅ Decryption complete. Required next steps:`)
      console.log(`   1. Set TENANT_DATA_ENCRYPTION=false in your environment / secrets`)
      console.log(`   2. Restart all application replicas`)
      console.log(`   3. Run: mercato query_index reindex --tenant ${tenantIdArg}  ← run after env flip + restart; search/filter degraded until this completes`)
      console.log(`   4. Run: mercato entities decrypt-database --tenant ${tenantIdArg} --check  to confirm no encrypted values remain`)
      console.log(`   NOTE: if the run was long and concurrent inserts occurred, run again before step 4 — it is idempotent.`)
    }
  },
}

// Keep default export stable (install first for help listing)
export default [seedDefs, reinstallDefs, addField, seedEncryptionMaps, rotateEncryptionKey, decryptDatabase]
