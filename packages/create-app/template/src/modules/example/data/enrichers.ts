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
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { ExampleCustomerPriority, Todo } from './entities'

type CustomerRecord = Record<string, unknown> & { id: string }

type TodoEnrichment = {
  _example: {
    todoCount: number
    openTodoCount: number
    priority: 'low' | 'normal' | 'high' | 'critical'
    priorityId?: string | null
    priorityUpdatedAt?: string | null
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
  features: ['example.view'],
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
    const priority = await findOneWithDecryption(em, ExampleCustomerPriority, {
      customerId: record.id,
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      deletedAt: null,
    }, { orderBy: { updatedAt: 'desc', createdAt: 'desc' } }, { tenantId: context.tenantId, organizationId: context.organizationId })

    return {
      ...record,
      _example: {
        todoCount: scoped.todoCount,
        openTodoCount: scoped.openTodoCount,
        ...priorityNamespace(priority),
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
      ? await findWithDecryption(em, ExampleCustomerPriority, {
          customerId: { $in: customerIds },
          organizationId: context.organizationId,
          tenantId: context.tenantId,
          deletedAt: null,
        }, { orderBy: { updatedAt: 'desc', createdAt: 'desc' } }, { tenantId: context.tenantId, organizationId: context.organizationId })
      : []
    const priorityByCustomerId = new Map<string, ExampleCustomerPriority>()
    for (const entry of priorities) {
      if (priorityByCustomerId.has(entry.customerId)) continue
      priorityByCustomerId.set(entry.customerId, entry)
    }

    return records.map((record) => ({
      ...record,
      _example: {
        ...(statsByBucket.get(getPersonBucket(record.id)) ?? { todoCount: 0, openTodoCount: 0 }),
        ...priorityNamespace(priorityByCustomerId.get(record.id) ?? null),
      },
    }))
  },
}

function priorityNamespace(priority: ExampleCustomerPriority | null) {
  return {
    priority: priority?.priority ?? 'normal',
    priorityId: priority?.id ?? null,
    priorityUpdatedAt: priority?.updatedAt.toISOString() ?? null,
  }
}

function createPriorityEnricher(targetEntity: 'customers.company' | 'customers.deal'): ResponseEnricher<CustomerRecord> {
  return {
    id: `example.${targetEntity.split('.')[1]}-priority`,
    targetEntity,
    features: ['example.view'],
    cacheableOnListHit: false,
    async enrichOne(record, context) {
      const em = forkEnricherEntityManager(context)
      const priority = await findOneWithDecryption(em, ExampleCustomerPriority, {
        customerId: record.id,
        organizationId: context.organizationId,
        tenantId: context.tenantId,
        deletedAt: null,
      }, { orderBy: { updatedAt: 'desc', createdAt: 'desc' } }, { tenantId: context.tenantId, organizationId: context.organizationId })
      return { ...record, _example: priorityNamespace(priority) }
    },
    async enrichMany(records, context) {
      const em = forkEnricherEntityManager(context)
      const priorities = records.length ? await findWithDecryption(em, ExampleCustomerPriority, {
        customerId: { $in: records.map((record) => record.id) },
        organizationId: context.organizationId,
        tenantId: context.tenantId,
        deletedAt: null,
      }, { orderBy: { updatedAt: 'desc', createdAt: 'desc' } }, { tenantId: context.tenantId, organizationId: context.organizationId }) : []
      const byCustomer = new Map<string, ExampleCustomerPriority>()
      for (const priority of priorities) {
        if (!byCustomer.has(priority.customerId)) byCustomer.set(priority.customerId, priority)
      }
      return records.map((record) => ({ ...record, _example: priorityNamespace(byCustomer.get(record.id) ?? null) }))
    },
  }
}

export const enrichers: ResponseEnricher[] = [
  customerTodoCountEnricher,
  createPriorityEnricher('customers.company'),
  createPriorityEnricher('customers.deal'),
]
