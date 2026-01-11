import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { WorkflowDefinition } from './data/entities'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Parse CLI arguments
 */
function parseArgs(args: string[]) {
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^-+/, '')  // Remove one or more dashes
    const value = args[i + 1]
    if (key && value) {
      result[key] = value
    }
  }
  return result
}

/**
 * Seed demo checkout workflow
 */
const seedDemo: ModuleCli = {
  command: 'seed-demo',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? args.t ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? args.o ?? '')

    if (!tenantId || !organizationId) {
      console.error('Usage: mercato workflows seed-demo --tenant <tenantId> --org <organizationId>')
      console.error('   or: mercato workflows seed-demo -t <tenantId> -o <organizationId>')
      return
    }

    try {
      const { resolve } = await createRequestContainer()
      const em = resolve<EntityManager>('em')

      // Read the demo workflow definition
      const demoPath = path.join(__dirname, 'examples', 'checkout-demo-definition.json')
      const demoData = JSON.parse(fs.readFileSync(demoPath, 'utf8'))

      // Check if it already exists
      const existing = await em.findOne(WorkflowDefinition, {
        workflowId: demoData.workflowId,
        tenantId,
        organizationId,
      })

      if (existing) {
        console.log(`✓ Demo workflow '${demoData.workflowId}' already exists (ID: ${existing.id})`)
        return
      }

      // Create the workflow definition
      const workflow = em.create(WorkflowDefinition, {
        ...demoData,
        tenantId,
        organizationId,
      })

      await em.persistAndFlush(workflow)

      console.log(`✓ Seeded demo workflow: ${workflow.workflowName}`)
      console.log(`  - ID: ${workflow.id}`)
      console.log(`  - Workflow ID: ${workflow.workflowId}`)
      console.log(`  - Version: ${workflow.version}`)
      console.log(`  - Steps: ${workflow.definition.steps.length}`)
      console.log(`  - Transitions: ${workflow.definition.transitions.length}`)
      console.log('')
      console.log('Demo workflow is ready! You can now:')
      console.log('  1. View it in admin: /backend/definitions')
      console.log('  2. Try the demo page: /checkout-demo')
      console.log('  3. Start an instance via API: POST /api/workflows/instances')
      console.log('')
      console.log('Note: This workflow includes a USER_TASK step for customer information.')
      console.log('When the workflow reaches this step, it will pause and require user input.')
      console.log('Complete pending tasks at: /backend/tasks')
    } catch (error) {
      console.error('Error seeding demo workflow:', error)
      throw error
    }
  },
}

/**
 * Seed sales pipeline example
 */
const seedSalesPipeline: ModuleCli = {
  command: 'seed-sales-pipeline',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? args.t ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? args.o ?? '')

    if (!tenantId || !organizationId) {
      console.error('Usage: mercato workflows seed-sales-pipeline --tenant <tenantId> --org <organizationId>')
      return
    }

    try {
      const { resolve } = await createRequestContainer()
      const em = resolve<EntityManager>('em')

      // Read the sales pipeline workflow definition
      const pipelinePath = path.join(__dirname, 'examples', 'sales-pipeline-definition.json')
      const pipelineData = JSON.parse(fs.readFileSync(pipelinePath, 'utf8'))

      // Check if it already exists
      const existing = await em.findOne(WorkflowDefinition, {
        workflowId: pipelineData.workflowId,
        tenantId,
        organizationId,
      })

      if (existing) {
        console.log(`✓ Sales pipeline workflow '${pipelineData.workflowId}' already exists (ID: ${existing.id})`)
        return
      }

      // Create the workflow definition
      const workflow = em.create(WorkflowDefinition, {
        ...pipelineData,
        tenantId,
        organizationId,
      })

      await em.persistAndFlush(workflow)

      console.log(`✓ Seeded sales pipeline workflow: ${workflow.workflowName}`)
      console.log(`  - ID: ${workflow.id}`)
      console.log(`  - Workflow ID: ${workflow.workflowId}`)
      console.log(`  - Version: ${workflow.version}`)
      console.log(`  - Steps: ${workflow.definition.steps.length}`)
      console.log(`  - Transitions: ${workflow.definition.transitions.length}`)
      console.log(`  - Activities: ${workflow.definition.transitions.reduce((sum, t) => sum + (t.activities?.length || 0), 0)}`)
      console.log('')
      console.log('Sales pipeline workflow is ready!')
    } catch (error) {
      console.error('Error seeding sales pipeline workflow:', error)
      throw error
    }
  },
}

/**
 * Seed simple approval example
 */
const seedSimpleApproval: ModuleCli = {
  command: 'seed-simple-approval',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? args.t ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? args.o ?? '')

    if (!tenantId || !organizationId) {
      console.error('Usage: mercato workflows seed-simple-approval --tenant <tenantId> --org <organizationId>')
      return
    }

    try {
      const { resolve } = await createRequestContainer()
      const em = resolve<EntityManager>('em')

      // Read the simple approval workflow definition
      const approvalPath = path.join(__dirname, 'examples', 'simple-approval-definition.json')
      const approvalData = JSON.parse(fs.readFileSync(approvalPath, 'utf8'))

      // Check if it already exists
      const existing = await em.findOne(WorkflowDefinition, {
        workflowId: approvalData.workflowId,
        tenantId,
        organizationId,
      })

      if (existing) {
        console.log(`✓ Simple approval workflow '${approvalData.workflowId}' already exists (ID: ${existing.id})`)
        return
      }

      // Create the workflow definition
      const workflow = em.create(WorkflowDefinition, {
        ...approvalData,
        tenantId,
        organizationId,
      })

      await em.persistAndFlush(workflow)

      console.log(`✓ Seeded simple approval workflow: ${workflow.workflowName}`)
      console.log(`  - ID: ${workflow.id}`)
      console.log(`  - Workflow ID: ${workflow.workflowId}`)
      console.log(`  - Version: ${workflow.version}`)
      console.log(`  - Steps: ${workflow.definition.steps.length}`)
      console.log(`  - Transitions: ${workflow.definition.transitions.length}`)
      console.log('')
      console.log('Simple approval workflow is ready!')
    } catch (error) {
      console.error('Error seeding simple approval workflow:', error)
      throw error
    }
  },
}

/**
 * Start workflow activity worker
 */
const startWorker: ModuleCli = {
  command: 'start-worker',
  async run(rest) {
    const args = parseArgs(rest)
    const concurrency = parseInt(args.concurrency ?? args.c ?? '5')

    const strategy = process.env.QUEUE_STRATEGY === 'async' ? 'async' : 'local'

    console.log('[Workflow Worker] Starting activity worker...')
    console.log(`[Workflow Worker] Strategy: ${strategy}`)

    if (strategy === 'local') {
      const pollMs = process.env.LOCAL_QUEUE_POLL_MS || '5000'
      console.log(`[Workflow Worker] Polling interval: ${pollMs}ms`)
      console.log('[Workflow Worker] NOTE: Local strategy is for development only.')
      console.log('[Workflow Worker] Use QUEUE_STRATEGY=async with Redis for production.')
    } else {
      console.log(`[Workflow Worker] Concurrency: ${concurrency}`)
      console.log(`[Workflow Worker] Redis: ${process.env.REDIS_URL || process.env.QUEUE_REDIS_URL}`)
    }

    try {
      const container = await createRequestContainer()
      const em = container.resolve<EntityManager>('em')

      // Import queue and handler
      const { runWorker } = await import('@open-mercato/queue/worker')
      const { createActivityWorkerHandler } = await import('./lib/activity-worker-handler')
      const { WORKFLOW_ACTIVITIES_QUEUE_NAME } = await import('./lib/activity-queue-types')

      // Create handler
      const handler = createActivityWorkerHandler(em, container)

      // Run worker
      await runWorker({
        queueName: WORKFLOW_ACTIVITIES_QUEUE_NAME,
        handler,
        connection: strategy === 'async' ? {
          url: process.env.REDIS_URL || process.env.QUEUE_REDIS_URL,
        } : undefined,
        concurrency,
        gracefulShutdown: true,
      })
    } catch (error) {
      console.error('[Workflow Worker] Failed to start worker:', error)
      throw error
    }
  },
}

/**
 * Seed checkout failure demo
 */
const seedCheckoutFailure: ModuleCli = {
  command: 'seed-checkout-failure',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? args.t ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? args.o ?? '')

    if (!tenantId || !organizationId) {
      console.error('Usage: mercato workflows seed-checkout-failure --tenant <tenantId> --org <organizationId>')
      return
    }

    try {
      const { resolve } = await createRequestContainer()
      const em = resolve<EntityManager>('em')

      // Read the failure demo workflow definition
      const failurePath = path.join(__dirname, 'examples', 'checkout-failure-demo.json')
      const failureData = JSON.parse(fs.readFileSync(failurePath, 'utf8'))

      // Check if it already exists
      const existing = await em.findOne(WorkflowDefinition, {
        workflowId: failureData.workflowId,
        tenantId,
        organizationId,
      })

      if (existing) {
        console.log(`✓ Checkout failure demo workflow '${failureData.workflowId}' already exists (ID: ${existing.id})`)
        return
      }

      // Create the workflow definition
      const workflow = em.create(WorkflowDefinition, {
        ...failureData,
        tenantId,
        organizationId,
      })

      await em.persistAndFlush(workflow)

      console.log(`✓ Seeded checkout failure demo workflow: ${workflow.workflowName}`)
      console.log(`  - ID: ${workflow.id}`)
      console.log(`  - Workflow ID: ${workflow.workflowId}`)
      console.log(`  - Version: ${workflow.version}`)
      console.log(`  - Steps: ${workflow.definition.steps.length}`)
      console.log(`  - Transitions: ${workflow.definition.transitions.length}`)
      console.log('')
      console.log('Checkout failure demo workflow is ready!')
      console.log('This workflow is designed to fail at the payment step to demonstrate')
      console.log('the compensation (saga pattern) feature.')
    } catch (error) {
      console.error('Error seeding checkout failure demo workflow:', error)
      throw error
    }
  },
}

/**
 * Seed all example workflows
 */
const seedAll: ModuleCli = {
  command: 'seed-all',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? args.t ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? args.o ?? '')

    if (!tenantId || !organizationId) {
      console.error('Usage: mercato workflows seed-all --tenant <tenantId> --org <organizationId>')
      return
    }

    console.log('Seeding all example workflows...\n')

    try {
      // Seed demo checkout
      await seedDemo.run(rest)
      console.log('')

      // Seed sales pipeline
      await seedSalesPipeline.run(rest)
      console.log('')

      // Seed simple approval
      await seedSimpleApproval.run(rest)
      console.log('')

      // Seed checkout failure demo
      await seedCheckoutFailure.run(rest)
      console.log('')

      console.log('✓ All example workflows seeded successfully!')
    } catch (error) {
      console.error('Error seeding workflows:', error)
      throw error
    }
  },
}

/**
 * Manually process pending workflow activities
 */
const processActivities: ModuleCli = {
  command: 'process-activities',
  async run(rest) {
    const args = parseArgs(rest)
    const limit = parseInt(args.limit ?? args.l ?? '0')

    console.log('[Workflow Activities] Processing pending activities...')
    if (limit > 0) {
      console.log(`[Workflow Activities] Limit: ${limit} jobs`)
    }

    try {
      const container = await createRequestContainer()
      const em = container.resolve<EntityManager>('em')

      // Import queue and handler
      const { createQueue } = await import('@open-mercato/queue')
      const { createActivityWorkerHandler } = await import('./lib/activity-worker-handler')
      const { WORKFLOW_ACTIVITIES_QUEUE_NAME } = await import('./lib/activity-queue-types')

      // Create queue instance
      const queue = createQueue(WORKFLOW_ACTIVITIES_QUEUE_NAME, 'local', {
        baseDir: process.env.QUEUE_BASE_DIR || '.queue',
      })

      // Create handler
      const handler = createActivityWorkerHandler(em, container)

      // Get initial counts
      const initialCounts = await queue.getJobCounts()
      console.log(`[Workflow Activities] Pending jobs: ${initialCounts.waiting}`)

      if (initialCounts.waiting === 0) {
        console.log('[Workflow Activities] No jobs to process')
        await queue.close()
        return
      }

      // Process jobs
      const result = await queue.process(handler as any, limit > 0 ? { limit } : undefined)

      console.log(`\n[Workflow Activities] ✓ Processed ${result.processed} activities`)
      if (result.failed > 0) {
        console.log(`[Workflow Activities] ✗ Failed: ${result.failed} activities`)
      }

      // Show remaining
      const finalCounts = await queue.getJobCounts()
      if (finalCounts.waiting > 0) {
        console.log(`[Workflow Activities] Remaining: ${finalCounts.waiting} jobs`)
      }

      await queue.close()
    } catch (error) {
      console.error('[Workflow Activities] Error processing activities:', error)
      throw error
    }
  },
}

const workflowsCliCommands = [
  startWorker,
  processActivities,
  seedDemo,
  seedSalesPipeline,
  seedSimpleApproval,
  seedCheckoutFailure,
  seedAll,
]

export default workflowsCliCommands
