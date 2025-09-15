import type { ModuleCli } from '@/modules/registry'
import { modules } from '@/generated/modules.generated'
import { createRequestContainer } from '@/lib/di/container'
import { CustomFieldDef } from '@open-mercato/core/modules/custom_fields/data/entities'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

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
    const orgIdArg = (args.org as string) || (args.organizationId as string)
    const globalFlag = Boolean(args.global)
    const dry = Boolean(args['dry-run'] || args.dry)
    if (!globalFlag && !orgIdArg) {
      console.error('Usage: mercato custom_fields install [--global] [--org <id>] [--dry-run]')
      return
    }
    const targetOrgId = globalFlag ? null : Number(orgIdArg)
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any

    // Collect all declared fieldSets from enabled modules
    const sets: Array<{ moduleId: string; entity: string; fields: any[]; source?: string }> = []
    for (const m of modules) {
      const fieldSets = (m as any).customFieldSets as any[] | undefined
      if (!fieldSets?.length) continue
      for (const s of fieldSets) sets.push({ moduleId: m.id, entity: s.entity, fields: s.fields, source: s.source ?? m.id })
    }
    if (!sets.length) { console.log('No fieldSets declared by modules. Nothing to seed.'); return }

    let created = 0, updated = 0
    for (const s of sets) {
      for (const f of s.fields) {
        const where = { entityId: s.entity, organizationId: targetOrgId, key: f.key }
        const existing = await em.findOne(CustomFieldDef, where)
        const configJson: any = {}
        if (f.options) configJson.options = f.options
        if (f.defaultValue !== undefined) configJson.defaultValue = f.defaultValue
        if (f.required !== undefined) configJson.required = f.required
        if (f.multi !== undefined) configJson.multi = f.multi
        if (f.filterable !== undefined) configJson.filterable = f.filterable
        if (f.indexed !== undefined) configJson.indexed = f.indexed
        if (f.label !== undefined) configJson.label = f.label
        if (f.description !== undefined) configJson.description = f.description
        if (!existing) {
          if (!dry) await em.persistAndFlush(em.create(CustomFieldDef, {
            entityId: s.entity,
            organizationId: targetOrgId,
            key: f.key,
            kind: f.kind,
            configJson,
            isActive: true,
          }))
          created++
        } else {
          const patch: any = {}
          if (existing.kind !== f.kind) patch.kind = f.kind
          patch.configJson = configJson
          patch.isActive = true
          if (!dry) { em.assign(existing, patch); await em.flush() }
          updated++
        }
      }
    }
    console.log(`Field definitions ensured: created=${created}, updated=${updated}${dry ? ' (dry-run)' : ''}`)
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
      const orgId = isGlobal ? null : Number((args.org as string) || (args.organizationId as string) || await ask('Organization ID'))
      const key = (args.key as string) || await ask('Field key (snake_case)')
      let kind = (args.kind as string) || await ask("Kind (text|multiline|integer|float|boolean|select)", 'text')
      kind = kind.toLowerCase()
      if (!['text','multiline','integer','float','boolean','select'].includes(kind)) throw new Error('Invalid kind')
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
      const indexed = args.indexed !== undefined ? Boolean(args.indexed) : await askBool('Indexed?', false)

      const where = { entityId, organizationId: orgId, key }
      const existing = await em.findOne(CustomFieldDef, where)
      const configJson: any = {}
      if (options) configJson.options = options
      if (defaultValue !== undefined) configJson.defaultValue = defaultValue
      if (required !== undefined) configJson.required = required
      if (multi !== undefined) configJson.multi = multi
      if (filterable !== undefined) configJson.filterable = filterable
      if (indexed !== undefined) configJson.indexed = indexed
      if (label !== undefined) configJson.label = label
      if (description !== undefined) configJson.description = description

      if (!existing) {
        await em.persistAndFlush(em.create(CustomFieldDef, {
          entityId,
          organizationId: orgId,
          key,
          kind,
          configJson,
          isActive: true,
        }))
        console.log(`Created custom field: ${entityId}.${key} (${kind})${orgId == null ? ' [global]' : ` [org=${orgId}]`}`)
      } else {
        existing.kind = kind as any
        existing.configJson = configJson
        existing.isActive = true
        await em.flush()
        console.log(`Updated custom field: ${entityId}.${key} (${kind})${orgId == null ? ' [global]' : ` [org=${orgId}]`}`)
      }
    } catch (e: any) {
      console.error('Failed:', e?.message || e)
    } finally {
      await rl.close()
    }
  },
}

// Keep default export stable (install first for help listing)
export default [seedDefs, addField]
