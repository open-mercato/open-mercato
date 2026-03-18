import { z } from 'zod'

export const exampleItemCreateSchema = z.object({
  title: z.string().min(1).max(200),
})

export type ExampleItemCreateInput = z.infer<typeof exampleItemCreateSchema>

export const customerPriorityValueSchema = z.enum(['low', 'normal', 'high', 'critical'])

export const customerPriorityCreateSchema = z.object({
  customerId: z.string().uuid(),
  priority: customerPriorityValueSchema.default('normal'),
})

export const customerPriorityUpdateSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  priority: customerPriorityValueSchema.optional(),
})

export const customerPriorityListSchema = z.object({
  id: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.enum(['id', 'customer_id', 'priority', 'created_at']).optional().default('created_at'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
})
