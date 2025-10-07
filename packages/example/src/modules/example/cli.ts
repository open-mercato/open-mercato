import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import { Todo } from '@open-mercato/example/modules/example/data/entities'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { E } from '@open-mercato/example/datamodel/entities'

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
    const tenantIdArg = args.tenant || args.tenantId
    if (!orgIdArg) {
      console.error('Usage: mercato example seed-todos --org <organizationId> --tenant <tenantId>')
      return
    }
    if (!tenantIdArg) {
      console.error('Usage: mercato example seed-todos --org <organizationId> --tenant <tenantId>')
      return
    }
    const orgId = orgIdArg as string
    const tenantId = tenantIdArg as string
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any

    // Ensure custom field definitions exist for example:todo
    const entityId = E.example.todo
    const defs = [
      { key: 'priority', kind: 'integer', configJson: { label: 'Priority', description: '1 (low) to 5 (high)', defaultValue: 3, filterable: true, validation: [
        { rule: 'required', message: 'Priority is required' },
        { rule: 'integer', message: 'Priority must be an integer' },
        { rule: 'gte', param: 1, message: 'Priority must be >= 1' },
        { rule: 'lte', param: 5, message: 'Priority must be <= 5' },
      ] } },
      { key: 'severity', kind: 'select', configJson: { label: 'Severity', options: ['low', 'medium', 'high'], defaultValue: 'medium', filterable: true, validation: [
        { rule: 'required', message: 'Severity is required' },
      ] } },
      { key: 'blocked', kind: 'boolean', configJson: { label: 'Blocked', defaultValue: false, filterable: true } },
      // Use text + multi so UI renders TagsInput in forms and tags filter in filters
      { key: 'labels', kind: 'text', configJson: { label: 'Labels', options: ['frontend', 'backend', 'ops', 'bug', 'feature'], multi: true, filterable: true, optionsUrl: '/api/example/tags', validation: [
        { rule: 'regex', param: '^[a-z0-9_-]+$', message: 'Labels must be slug-like' }
      ] } },
      { key: 'attachments', kind: 'attachment', configJson: { label: 'Attachments', maxAttachmentSizeMb: 10, acceptExtensions: ['pdf', 'jpg', 'png'] } },
    ]
    for (const d of defs) {
      const existing = await em.findOne(CustomFieldDef, { entityId, organizationId: orgId, tenantId: tenantId, key: d.key })
      if (!existing) {
        await em.persistAndFlush(em.create(CustomFieldDef, { // set the field per tenantId not by organizationId
          entityId,
          tenantId: tenantId,
          organizationId: null,
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
    const labelsOptions = ['frontend', 'backend', 'ops', 'bug', 'feature']
    const makePriority = (i: number) => (i % 5) + 1
    const makeSeverity = (i: number) => severities[i % severities.length]
    const makeBlocked = (i: number) => i % 4 === 0 // every 4th is blocked

    for (let i = 0; i < titles.length; i++) {
      const todo = em.create(Todo, { title: titles[i], isDone: i % 3 === 0, organizationId: orgId, tenantId })
      await em.persistAndFlush(todo)
      const recordId = String(todo.id)
      const de = resolve('dataEngine') as DataEngine
      await de.setCustomFields({
        entityId,
        recordId,
        organizationId: orgId,
        tenantId: tenantId,
        values: {
          priority: makePriority(i),
          severity: makeSeverity(i),
          blocked: makeBlocked(i),
          labels: [labelsOptions[i % labelsOptions.length], labelsOptions[(i + 2) % labelsOptions.length]].filter((v, idx, arr) => arr.indexOf(v) === idx),
        },
      })
    }
    console.log(`Seeded 10 todos with custom fields for org=${orgId}, tenant=${tenantId}`)
  },
}

export default [hello, seedTodos]
