import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import { Todo } from '@/modules/example/data/entities'
import { CustomFieldDef, CustomFieldValue } from '@open-mercato/core/modules/custom_fields/data/entities'

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

const hello: ModuleCli = {
  command: 'hello',
  async run() { console.log('Hello from example module!') },
}

const seedTodos: ModuleCli = {
  command: 'seed-todos',
  async run(rest) {
    const args = parseArgs(rest)
    const orgIdArg = args.org || args.organizationId
    if (!orgIdArg) {
      console.error('Usage: mercato example seed-todos --org <organizationId> [--tenant <tenantId>]')
      return
    }
    const orgId = Number(orgIdArg)
    const tenantId = args.tenant ? Number(args.tenant) : undefined
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any

    // Ensure custom field definitions exist for example:todo
    const entityId = 'example:todo'
    const defs = [
      { key: 'priority', kind: 'integer', configJson: { label: 'Priority', description: '1 (low) to 5 (high)', defaultValue: 3, filterable: true } },
      { key: 'severity', kind: 'select', configJson: { label: 'Severity', options: ['low', 'medium', 'high'], defaultValue: 'medium', filterable: true } },
      { key: 'blocked', kind: 'boolean', configJson: { label: 'Blocked', defaultValue: false, filterable: true } },
    ]
    for (const d of defs) {
      const existing = await em.findOne(CustomFieldDef, { entityId, organizationId: orgId, key: d.key })
      if (!existing) {
        await em.persistAndFlush(em.create(CustomFieldDef, {
          entityId,
          organizationId: orgId,
          key: d.key,
          kind: d.kind,
          configJson: d.configJson,
          isActive: true,
        }))
      } else {
        existing.kind = d.kind as any
        existing.configJson = d.configJson
        existing.isActive = true
        await em.flush()
      }
    }

    // Seed 10 todos with custom field values
    const titles = Array.from({ length: 10 }).map((_, i) => `Todo #${i + 1}`)
    const severities = ['low', 'medium', 'high']
    const makePriority = (i: number) => (i % 5) + 1
    const makeSeverity = (i: number) => severities[i % severities.length]
    const makeBlocked = (i: number) => i % 4 === 0 // every 4th is blocked

    for (let i = 0; i < titles.length; i++) {
      const todo = em.create(Todo, { title: titles[i], isDone: i % 3 === 0, organizationId: orgId, tenantId })
      await em.persistAndFlush(todo)
      const recordId = String(todo.id)
      const values = [
        em.create(CustomFieldValue, { entityId, recordId, organizationId: orgId, fieldKey: 'priority', valueInt: makePriority(i) }),
        em.create(CustomFieldValue, { entityId, recordId, organizationId: orgId, fieldKey: 'severity', valueText: makeSeverity(i) }),
        em.create(CustomFieldValue, { entityId, recordId, organizationId: orgId, fieldKey: 'blocked', valueBool: makeBlocked(i) }),
      ]
      await em.persistAndFlush(values)
    }
    console.log(`Seeded 10 todos with custom fields for org=${orgId}${tenantId ? `, tenant=${tenantId}` : ''}`)
  },
}

export default [hello, seedTodos]
