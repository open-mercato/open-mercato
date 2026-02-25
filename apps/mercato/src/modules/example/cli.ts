import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer, type AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Todo } from './data/entities'
import { installCustomEntitiesFromModules } from '@open-mercato/core/modules/entities/lib/install-from-ce'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { E } from '@/.mercato/generated/entities.ids.generated'
import type { CacheStrategy } from '@open-mercato/cache/types'
import { parseCliArgs, cliLogger, buildUsage } from '@open-mercato/cli/lib/helpers'

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

const logger = cliLogger.forModule('example')

export async function seedExampleTodos(
  em: EntityManager,
  container: AppContainer,
  { organizationId, tenantId }: TodoSeedArgs,
): Promise<boolean> {
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
    logger: (message: string) => logger.debug(message),
  })

  const existing = await em.count(Todo, { organizationId, tenantId })
  if (existing > 0) {
    logger.info(`📝 Example todos already seeded for org=${organizationId}, tenant=${tenantId}; skipping`)
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

  logger.success(`Seeded ${todos.length} todos with custom fields for org=${organizationId}, tenant=${tenantId}`)
  return true
}

const hello: ModuleCli = {
  command: 'hello',
  async run() {
    logger.success('Hello from example module!')
  },
}

const seedTodos: ModuleCli = {
  command: 'seed-todos',
  async run(rest) {
    const { args, missing } = parseCliArgs(rest, {
      string: ['org', 'organizationId', 'tenant', 'tenantId'],
      alias: { o: 'org', t: 'tenant' },
      required: ['org', 'tenant'],
    })

    if (missing.length > 0) {
      logger.error(`Missing required arguments: ${missing.map(m => `--${m}`).join(', ')}`)
      logger.info(`Usage: ${buildUsage('mercato example seed-todos', {
        required: ['org', 'tenant'],
        alias: { o: 'org', t: 'tenant' }
      })}`)
      return
    }

    const orgId = (args.org || args.organizationId) as string
    const tenantId = (args.tenant || args.tenantId) as string
    
    const spinner = logger.spinner('Seeding example todos...')
    
    try {
      const container = await createRequestContainer()
      const em = (container.resolve('em') as EntityManager)

      const success = await seedExampleTodos(em, container, { organizationId: orgId, tenantId })
      
      if (success) {
        spinner.stop('Successfully seeded example todos!')
      } else {
        spinner.stop('Example todos already exist, skipping.')
      }
    } catch (error) {
      spinner.fail(`Failed to seed todos: ${error instanceof Error ? error.message : String(error)}`)
    }
  },
}

export default [hello, seedTodos]
export type { TodoSeedArgs as ExampleTodoSeedArgs }
