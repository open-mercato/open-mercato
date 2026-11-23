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
 * The grouped todo query reads UUIDs and completion flags. Entity reads that
 * need the encrypted `Todo.notes` field still use `findWithDecryption`.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { ExampleCustomerPriority } from './entities'

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
const EMPTY_TODO_STATS = { todoCount: 0, openTodoCount: 0 }

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

function buildTodoBucketExpression(): string {
  const terms: string[] = []
  let weight = 1
  for (let position = 36; position >= 1; position--) {
    terms.push(`ascii(substr(id::text, ${position}, 1))::bigint * ${weight}`)
    weight = Math.imul(weight, 31)
  }
  return `abs(((${terms.join(' + ')} + 2147483648) & 4294967295) - 2147483648) % ${PERSON_BUCKET_COUNT}`
}

/**
 * PostgreSQL UUIDs render as 36 ASCII characters. Each character's coefficient
 * is a power of 31, and the mask restores the signed 32-bit wrap in hashString.
 */
const TODO_BUCKET_SQL = buildTodoBucketExpression()

async function loadBucketStats(em: EntityManager, context: EnricherContext, buckets: number[]) {
  const rows = await em.execute<Array<{ bucket: number; todoCount: string; openTodoCount: string }>>(
    `select bucket, count(*) as "todoCount", count(*) filter (where is_done is not true) as "openTodoCount"
     from (
       select (${TODO_BUCKET_SQL})::integer as bucket, is_done
       from todos
       where tenant_id = ? and organization_id = ? and deleted_at is null
     ) as scoped_todos
     where bucket in (${buckets.map(() => '?').join(', ')})
     group by bucket`,
    [context.tenantId, context.organizationId, ...buckets],
  )
  return new Map(rows.map((row) => [
    row.bucket,
    { todoCount: Number(row.todoCount), openTodoCount: Number(row.openTodoCount) },
  ]))
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
    const bucket = getPersonBucket(record.id)
    const statsByBucket = await loadBucketStats(em, context, [bucket])
    const priority = await findOneWithDecryption(em, ExampleCustomerPriority, {
      customerId: record.id,
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      deletedAt: null,
    }, { orderBy: { updatedAt: 'desc', createdAt: 'desc' } }, { tenantId: context.tenantId, organizationId: context.organizationId })

    return {
      ...record,
      _example: {
        ...(statsByBucket.get(bucket) ?? EMPTY_TODO_STATS),
        ...priorityNamespace(priority),
      },
    }
  },

  async enrichMany(records, context) {
    if (records.length === 0) return []

    const em = forkEnricherEntityManager(context)
    const customerIds = records.map((record) => record.id)
    const buckets = [...new Set(customerIds.map(getPersonBucket))]
    const statsByBucket = await loadBucketStats(em, context, buckets)
    const priorities = await findWithDecryption(em, ExampleCustomerPriority, {
      customerId: { $in: customerIds },
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      deletedAt: null,
    }, { orderBy: { updatedAt: 'desc', createdAt: 'desc' } }, { tenantId: context.tenantId, organizationId: context.organizationId })
    const priorityByCustomerId = new Map<string, ExampleCustomerPriority>()
    for (const entry of priorities) {
      if (priorityByCustomerId.has(entry.customerId)) continue
      priorityByCustomerId.set(entry.customerId, entry)
    }

    return records.map((record) => ({
      ...record,
      _example: {
        ...(statsByBucket.get(getPersonBucket(record.id)) ?? EMPTY_TODO_STATS),
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
