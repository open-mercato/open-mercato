import { z } from 'zod'

export const exampleItemCreateSchema = z.object({
  title: z.string().min(1).max(200),
})

/**
 * Free-text notes on a todo. Encrypted at rest via the module's `encryption.ts`,
 * so the bound is deliberate: ciphertext is materially larger than its plaintext
 * and an unbounded column would let a single record dominate an index doc.
 * `nullable` (not just optional) so a client can clear the field explicitly.
 */
export const todoNotesSchema = z.string().max(5000).nullable()

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

const resendStubFixtureAttachmentSchema = z.object({
  id: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/).optional(),
  filename: z.string().max(255).nullable().optional(),
  contentType: z.string().trim().min(1).max(255),
  contentBase64: z.string().max(40 * 1024 * 1024).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  contentDisposition: z.enum(['attachment', 'inline']).nullable().optional(),
  contentId: z.string().max(255).nullable().optional(),
})

/** Test-only: an inbound email fixture registered with the Resend stub (`OM_ENABLE_RESEND_STUB`). */
export const resendStubFixtureCreateSchema = z.object({
  id: z.string().uuid().optional(),
  from: z.string().trim().min(1).max(320),
  to: z.array(z.string().trim().min(1).max(320)).min(1).max(50),
  subject: z.string().max(998).default(''),
  text: z.string().max(1024 * 1024).nullable().optional(),
  html: z.string().max(1024 * 1024).nullable().optional(),
  messageId: z.string().trim().min(1).max(998),
  headers: z.record(z.string(), z.string().max(8192)).optional(),
  attachments: z.array(resendStubFixtureAttachmentSchema).max(50).default([]),
  failDownloads: z.boolean().optional(),
})

export type ResendStubFixtureCreateInput = z.infer<typeof resendStubFixtureCreateSchema>

export const resendStubFixtureUpdateSchema = z.object({
  failDownloads: z.boolean(),
})

export const resendStubSendEmailSchema = z.object({
  from: z.string().trim().min(1),
  to: z.union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)]),
  subject: z.string(),
}).passthrough()

export const resendStubListAttachmentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  after: z.string().trim().min(1).optional(),
})
