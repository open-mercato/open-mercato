/**
 * Example Response Enrichers
 *
 * Demonstrates how a module can enrich another module's API responses.
 * This enricher adds todo count data to customer person records.
 *
 * It reads other modules' tables (todos and per-customer priority), so its
 * output is not a pure function of the customer record's own cached state. It
 * therefore keeps `cacheableOnListHit` at the fail-closed default and re-runs on
 * every CRUD list cache hit so the counts stay fresh. See the
 * `cacheableOnListHit` guidance in packages/core/AGENTS.md for when an enricher
 * may opt into being served from the list cache on a hit.
 *
 * `Todo.notes` is an encrypted field (see `../encryption.ts`), so every `Todo`
 * read here goes through `findWithDecryption`. The fork below inherits the
 * request container's ORM subscribers, so `onLoad` would already decrypt and
 * this enricher only counts rows — but an enricher that later reads a `Todo`
 * field, or runs on a fork created with `freshEventManager: true`, would silently
 * observe ciphertext. The explicit helper is the rule the rest of this module
 * follows, and it is idempotent: plaintext that is not a v1 payload is left alone.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
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

/**
 * `EnricherContext.em` is typed `unknown` precisely so each consumer narrows it to the
 * handle it actually needs. Narrowing to `EntityManager` keeps every downstream
 * `em.find` / `em.findOne` typed; `as any` would erase all of them.
 */
function forkEnricherEntityManager(context: EnricherContext): EntityManager {
  return (context.em as EntityManager).fork()
}

const customerTodoCountEnricher: ResponseEnricher<CustomerRecord, TodoEnrichment> = {
  id: 'example.customer-todo-count',
  targetEntity: 'customers.person',
  priority: 10,
  timeout: 2000,
  cacheableOnListHit: false,
  fallback: {
    _example: { todoCount: 0, openTodoCount: 0, priority: 'normal' },
  },

  async enrichOne(record, context) {
    const em = forkEnricherEntityManager(context)
    const todos = await findWithDecryption(em, Todo, {
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      deletedAt: null,
    }, undefined, { tenantId: context.tenantId, organizationId: context.organizationId })
    const statsByBucket = buildBucketStats(todos)
    const scoped = statsByBucket.get(getPersonBucket(record.id)) ?? { todoCount: 0, openTodoCount: 0 }
    const priority = await em.findOne(ExampleCustomerPriority, {
      customerId: record.id,
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      deletedAt: null,
    }, { orderBy: { updatedAt: 'desc', createdAt: 'desc' } })

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
    const em = forkEnricherEntityManager(context)
    const todos = await findWithDecryption(em, Todo, {
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      deletedAt: null,
    }, undefined, { tenantId: context.tenantId, organizationId: context.organizationId })
    const statsByBucket = buildBucketStats(todos)
    const customerIds = records.map((record) => record.id)
    const priorities: ExampleCustomerPriority[] = customerIds.length > 0
      ? await em.find(ExampleCustomerPriority, {
          customerId: { $in: customerIds },
          organizationId: context.organizationId,
          tenantId: context.tenantId,
          deletedAt: null,
        }, { orderBy: { updatedAt: 'desc', createdAt: 'desc' } })
      : []
    const priorityByCustomerId = new Map<string, ExampleCustomerPriority['priority']>()
    for (const entry of priorities) {
      if (priorityByCustomerId.has(entry.customerId)) continue
      priorityByCustomerId.set(entry.customerId, entry.priority)
    }

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
