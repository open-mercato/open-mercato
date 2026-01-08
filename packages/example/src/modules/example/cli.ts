import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer, type AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Todo } from '@open-mercato/example/modules/example/data/entities'
import { installCustomEntitiesFromModules } from '@open-mercato/core/modules/entities/lib/install-from-ce'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { E } from '@open-mercato/example/datamodel/entities'
import type { CacheStrategy } from '@open-mercato/cache/types'

type TodoSeed = {
  title: string
  isDone?: boolean
  priority: number
  severity: 'low' | 'medium' | 'high'
  blocked?: boolean
  labels: string[]
  createdAt: string
}

const NOW = new Date()

function isoDaysFromNow(days: number, options?: { hour?: number; minute?: number }): string {
  const base = new Date(NOW)
  const hour = options?.hour ?? 12
  const minute = options?.minute ?? 0
  base.setUTCHours(hour, minute, 0, 0)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString()
}

const EXAMPLE_TODO_SEEDS: TodoSeed[] = [
  {
    title: 'Review onboarding checklist for Brightside Solar pilot',
    priority: 4,
    severity: 'medium',
    blocked: false,
    labels: ['customers', 'onboarding'],
    createdAt: isoDaysFromNow(-12, { hour: 14 }),
  },
  {
    title: 'Compile ROI dashboard snapshots for Harborview Analytics',
    priority: 5,
    severity: 'high',
    blocked: false,
    labels: ['customers', 'analytics'],
    createdAt: isoDaysFromNow(-9, { hour: 10, minute: 30 }),
  },
  {
    title: 'Prepare upsell talking points for Midwest Outfitters',
    priority: 3,
    severity: 'medium',
    blocked: false,
    labels: ['sales', 'expansion'],
    createdAt: isoDaysFromNow(-7, { hour: 9, minute: 45 }),
  },
  {
    title: 'Archive closed Cedar Creek design project',
    priority: 2,
    severity: 'low',
    blocked: false,
    labels: ['ops', 'cleanup'],
    isDone: true,
    createdAt: isoDaysFromNow(-60, { hour: 18, minute: 15 }),
  },
  {
    title: 'Draft Q3 roadmap summary for leadership sync',
    priority: 4,
    severity: 'high',
    blocked: false,
    labels: ['internal', 'planning'],
    createdAt: isoDaysFromNow(-5, { hour: 12, minute: 5 }),
  },
  {
    title: 'Update customer health scores in dashboard widgets',
    priority: 3,
    severity: 'medium',
    blocked: false,
    labels: ['customers', 'health'],
    createdAt: isoDaysFromNow(-3, { hour: 11, minute: 20 }),
  },
]

type TodoSeedArgs = {
  organizationId: string
  tenantId: string
}

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

export async function seedExampleTodos(
  em: EntityManager,
  container: AppContainer,
  { organizationId, tenantId }: TodoSeedArgs,
  options: { logger?: (message: string) => void } = {},
): Promise<boolean> {
  const logger = options.logger ?? (() => {})
  const entityId = E.example.todo

  let cache: CacheStrategy | null = null
  try {
    cache = container.resolve('cache') as CacheStrategy
  } catch {
    cache = null
  }

  await installCustomEntitiesFromModules(em as any, cache, {
    tenantIds: [tenantId],
    includeGlobal: false,
    dryRun: false,
    logger,
  })

  const existing = await em.count(Todo, { organizationId, tenantId })
  if (existing > 0) {
    logger(`📝 Example todos already seeded for org=${organizationId}, tenant=${tenantId}; skipping`)
    return false
  }

  const todos: Todo[] = []
  for (const seed of EXAMPLE_TODO_SEEDS) {
    const createdAt = new Date(seed.createdAt)
    const todo = em.create(Todo, {
      title: seed.title,
      isDone: seed.isDone ?? false,
      organizationId,
      tenantId,
      createdAt,
      updatedAt: createdAt,
    })
    em.persist(todo)
    todos.push(todo)
  }
  await em.flush()

  const de = (container.resolve('dataEngine') as DataEngine)
  for (let i = 0; i < todos.length; i++) {
    const todo = todos[i]
    const seed = EXAMPLE_TODO_SEEDS[i]
    await de.setCustomFields({
      entityId,
      recordId: String(todo.id),
      organizationId,
      tenantId,
      values: {
        priority: seed.priority,
        severity: seed.severity,
        blocked: seed.blocked ?? false,
        labels: seed.labels,
      },
    })
  }

  logger(`Seeded ${todos.length} todos with custom fields for org=${organizationId}, tenant=${tenantId}`)
  return true
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
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager)

    await seedExampleTodos(em, container, { organizationId: orgId, tenantId }, { logger: (message) => console.log(message) })
  },
}

export default [hello, seedTodos]
export type { TodoSeedArgs as ExampleTodoSeedArgs }
