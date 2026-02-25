/**
 * Example Response Enrichers
 *
 * Demonstrates how a module can enrich another module's API responses.
 * This enricher adds todo count data to customer person records.
 */

import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { Todo } from './entities'

type CustomerRecord = Record<string, unknown> & { id: string }

type TodoEnrichment = {
  _example: {
    todoCount: number
    openTodoCount: number
  }
}

const customerTodoCountEnricher: ResponseEnricher<CustomerRecord, TodoEnrichment> = {
  id: 'example.customer-todo-count',
  targetEntity: 'customers.person',
  features: ['example.view'],
  priority: 10,
  timeout: 2000,
  fallback: {
    _example: { todoCount: 0, openTodoCount: 0 },
  },

  async enrichOne(record, context) {
    const em = (context.em as any).fork()
    const todos = await em.find(Todo, {
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      deletedAt: null,
    })
    const todoCount = todos.length
    const openTodoCount = todos.filter((t: Todo) => !t.isDone).length

    return {
      ...record,
      _example: { todoCount, openTodoCount },
    }
  },

  async enrichMany(records, context) {
    const em = (context.em as any).fork()
    const todos = await em.find(Todo, {
      organizationId: context.organizationId,
      tenantId: context.tenantId,
      deletedAt: null,
    })
    const todoCount = todos.length
    const openTodoCount = todos.filter((t: Todo) => !t.isDone).length

    return records.map((record) => ({
      ...record,
      _example: { todoCount, openTodoCount },
    }))
  },
}

export const enrichers: ResponseEnricher[] = [customerTodoCountEnricher]
