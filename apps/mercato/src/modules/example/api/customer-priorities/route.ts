import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { id, customer_id, priority, organization_id, tenant_id, created_at } from '@/.mercato/generated/entities/example_customer_priority'
import { ExampleCustomerPriority } from '../../data/entities'
import {
  customerPriorityCreateSchema,
  customerPriorityListSchema,
  customerPriorityUpdateSchema,
} from '../../data/validators'
import {
  createExampleCrudOpenApi,
  createExamplePagedListResponseSchema,
  exampleOkSchema,
} from '../openapi'

type PriorityListQuery = z.infer<typeof customerPriorityListSchema>

const customerPriorityListItemSchema = z.object({
  id: z.string().uuid(),
  customer_id: z.string().uuid(),
  priority: z.enum(['low', 'normal', 'high', 'critical']),
  tenant_id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
})

const customerPriorityCreateResponseSchema = z.object({
  id: z.string().uuid(),
})

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['example.view'] },
    POST: { requireAuth: true, requireFeatures: ['example.todos.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['example.todos.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['example.todos.manage'] },
  },
  orm: {
    entity: ExampleCustomerPriority,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.example.example_customer_priority },
  list: {
    schema: customerPriorityListSchema,
    entityId: E.example.example_customer_priority,
    fields: [id, customer_id, priority, organization_id, tenant_id, created_at],
    sortFieldMap: {
      id,
      customer_id,
      priority,
      created_at,
    },
    buildFilters: async (query: PriorityListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.customerId) filters.customer_id = query.customerId
      return filters
    },
  },
  create: {
    schema: customerPriorityCreateSchema,
    mapToEntity: (input) => ({
      customerId: input.customerId,
      priority: input.priority,
    }),
    response: (entity) => ({ id: String(entity.id) }),
  },
  update: {
    schema: customerPriorityUpdateSchema,
    getId: (input) => input.id,
    applyToEntity: (entity, input) => {
      if (input.customerId) entity.customerId = input.customerId
      if (input.priority) entity.priority = input.priority
    },
    response: () => ({ ok: true }),
  },
  del: {
    idFrom: 'body',
    softDelete: true,
    response: () => ({ ok: true }),
  },
})

export const openApi = createExampleCrudOpenApi({
  resourceName: 'Customer Priority',
  pluralName: 'Customer Priorities',
  querySchema: customerPriorityListSchema,
  listResponseSchema: createExamplePagedListResponseSchema(customerPriorityListItemSchema),
  create: {
    schema: customerPriorityCreateSchema,
    responseSchema: customerPriorityCreateResponseSchema,
    description: 'Creates or stores customer priority records for injected CRUD fields.',
  },
  update: {
    schema: customerPriorityUpdateSchema,
    responseSchema: exampleOkSchema,
    description: 'Updates customer priority values.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: exampleOkSchema,
    description: 'Soft-deletes a customer priority record.',
  },
})
