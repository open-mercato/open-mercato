import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import { Todo } from '@open-mercato/example/modules/example/data/entities'
import { installCustomEntitiesFromModules } from '@open-mercato/core/modules/entities/lib/install-from-ce'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { E } from '@open-mercato/example/datamodel/entities'
import type { CacheStrategy } from '@open-mercato/cache/types'

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

    // Ensure module custom entities/fields are installed for this tenant
    const entityId = E.example.todo
    let cache: CacheStrategy | null = null
    try { cache = resolve('cache') as CacheStrategy } catch {}
    const installResult = await installCustomEntitiesFromModules(em as any, cache, {
      tenantIds: [tenantId],
      includeGlobal: false,
      dryRun: false,
      logger: (message) => console.log(message),
    })
    if (installResult.synchronized === 0 && installResult.fieldChanges === 0) {
      console.log(`Custom entity definitions already up to date for tenant=${tenantId}`)
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
