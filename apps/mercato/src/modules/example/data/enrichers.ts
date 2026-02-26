/**
 * Example Response Enrichers
 *
 * Demonstrates how a module can enrich another module's API responses.
 * This enricher adds todo count data to customer person records.
 */

import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { ExampleCustomerPriority, Todo } from './entities'

type CustomerRecord = Record<string, unknown> & { id: string }

type TodoEnrichment = {
  _example: {
    todoCount: number
    openTodoCount: number
    priority: 'low' | 'normal' | 'high' | 'critical'
  }
}

const PERSON_BUCKET_COUNT = 16

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function getPersonBucket(personId: string): number {
  return hashString(personId) % PERSON_BUCKET_COUNT
}

function buildBucketStats(todos: Todo[]): Map<number, { todoCount: number; openTodoCount: number }> {
  const stats = new Map<number, { todoCount: number; openTodoCount: number }>()
  for (const todo of todos) {
    const bucket = hashString(String(todo.id)) % PERSON_BUCKET_COUNT
    const current = stats.get(bucket) ?? { todoCount: 0, openTodoCount: 0 }
    current.todoCount += 1
    if (!todo.isDone) {
      current.openTodoCount += 1
    }
    stats.set(bucket, current)
  }
  return stats
}

const customerTodoCountEnricher: ResponseEnricher<CustomerRecord, TodoEnrichment> = {
  id: 'example.customer-todo-count',
  targetEntity: 'customers.person',
  priority: 10,
  timeout: 2000,
  fallback: {
    _example: { todoCount: 0, openTodoCount: 0, priority: 'normal' },
  },

  async enrichOne(record, context) {
    const em = (context.em as any).fork()
    const todos = await em.find(Todo, {
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      deletedAt: null,
    })
    const statsByBucket = buildBucketStats(todos)
    const scoped = statsByBucket.get(getPersonBucket(record.id)) ?? { todoCount: 0, openTodoCount: 0 }
    const priority = await em.findOne(ExampleCustomerPriority, {
      customerId: record.id,
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      deletedAt: null,
    })

    return {
      ...record,
      _example: {
        todoCount: scoped.todoCount,
        openTodoCount: scoped.openTodoCount,
        priority: (priority?.priority as TodoEnrichment['_example']['priority']) ?? 'normal',
      },
    }
  },

  async enrichMany(records, context) {
    const em = (context.em as any).fork()
    const todos = await em.find(Todo, {
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      deletedAt: null,
    })
    const statsByBucket = buildBucketStats(todos)
    const customerIds = records.map((record) => record.id)
    const priorities: ExampleCustomerPriority[] = customerIds.length > 0
      ? await em.find(ExampleCustomerPriority, {
          customerId: { $in: customerIds },
          organizationId: context.organizationId,
          tenantId: context.tenantId,
          deletedAt: null,
        })
      : []
    const priorityByCustomerId = new Map<string, ExampleCustomerPriority['priority']>(
      priorities.map((entry: ExampleCustomerPriority) => [entry.customerId, entry.priority])
    )

    return records.map((record) => ({
      ...record,
      _example: {
        ...(statsByBucket.get(getPersonBucket(record.id)) ?? { todoCount: 0, openTodoCount: 0 }),
        priority: (priorityByCustomerId.get(record.id) as TodoEnrichment['_example']['priority'] | undefined) ?? 'normal',
      },
    }))
  },
}

export const enrichers: ResponseEnricher[] = [customerTodoCountEnricher]
