import type { ModuleCli } from '@/modules/registry'
import { modules } from '@/generated/modules.generated'
import { createRequestContainer } from '@/lib/di/container'
import { CustomFieldDef } from '@open-mercato/core/modules/custom_fields/data/entities'

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
  command: 'seed-defs',
  async run(rest) {
    const args = parseArgs(rest)
    const orgIdArg = (args.org as string) || (args.organizationId as string)
    const globalFlag = Boolean(args.global)
    const dry = Boolean(args['dry-run'] || args.dry)
    if (!globalFlag && !orgIdArg) {
      console.error('Usage: mercato custom_fields seed-defs [--global] [--org <id>] [--dry-run]')
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

export default [seedDefs]

