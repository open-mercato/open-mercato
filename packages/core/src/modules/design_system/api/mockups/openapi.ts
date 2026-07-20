import { z } from 'zod'

export const designSystemTag = 'Design system'

export const mockupCountsSchema = z.object({
  implemented: z.number().int().nonnegative(),
  proposed: z.number().int().nonnegative(),
  omDefault: z.number().int().nonnegative(),
  placeholder: z.number().int().nonnegative(),
})

export const mockupListItemSchema = z.object({
  slug: z.string().describe('Mockup slug, unique across sources'),
  title: z.string().describe('Screen title from the document'),
  source: z.enum(['ai', 'module']).describe('Where the document lives: .ai/mockups or a module mockups/ folder'),
  counts: mockupCountsSchema.describe('Per-status block counts; placeholders tracked separately'),
  userStories: z.array(z.string()).describe('Distinct user-story tags present in the document'),
  modifiedAt: z.string().describe('File modification timestamp (ISO 8601)'),
})

export const mockupListResponseSchema = z.object({
  items: z.array(mockupListItemSchema),
})

export const mockupIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
})

export const mockupDetailResponseSchema = z.object({
  document: z.unknown().describe('The zod-validated mockup document'),
  counts: mockupCountsSchema,
  documentHash: z.string().describe('SHA-256 of the on-disk file content'),
})

export const mockupErrorSchema = z.object({
  error: z.string(),
  issues: z.array(mockupIssueSchema).optional(),
})

export const mockupAnnotationsRequestSchema = z.object({
  blocks: z
    .array(
      z.object({
        id: z.string(),
        status: z.enum(['implemented', 'proposed', 'om-default']),
        userStory: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .min(1),
})

export const mockupAnnotationsResponseSchema = z.object({
  ok: z.literal(true),
  counts: mockupCountsSchema,
  documentHash: z.string(),
})
