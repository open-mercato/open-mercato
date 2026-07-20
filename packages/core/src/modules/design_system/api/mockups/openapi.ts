import { z } from 'zod'
import { finding } from '../../mockups/schema'

export const designSystemTag = 'Design system'

export const mockupCountsSchema = z.object({
  implemented: z.number().int().nonnegative(),
  proposed: z.number().int().nonnegative(),
  omDefault: z.number().int().nonnegative(),
  placeholder: z.number().int().nonnegative(),
})

export const mockupFindingsSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  bySeverity: z.object({
    low: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative(),
  }),
  stale: z.number().int().nonnegative().describe('Findings whose atHash no longer matches the content hash'),
})

export const mockupListItemSchema = z.object({
  slug: z.string().describe('Mockup slug, unique across sources'),
  title: z.string().describe('Screen title from the document'),
  source: z.enum(['ai', 'module']).describe('Where the document lives: .ai/mockups or a module mockups/ folder'),
  counts: mockupCountsSchema.describe('Per-status block counts; placeholders tracked separately'),
  userStories: z.array(z.string()).describe('Distinct user-story tags present in the document'),
  findingsCount: z.number().int().nonnegative().describe('Total heuristic findings in the document'),
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
  findings: mockupFindingsSummarySchema,
  documentHash: z.string().describe('SHA-256 of the on-disk file content'),
  contentHash: z
    .string()
    .describe('SHA-256 of the findings-free canonical content — the atHash reference for findings'),
  copy: z
    .unknown()
    .nullable()
    .describe('Companion <slug>.copy.json document when present (om-ux-copy output)'),
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
        findings: z.array(finding).optional(),
      }),
    )
    .min(1),
  documentFindings: z.array(finding).optional(),
})

export const mockupAnnotationsResponseSchema = z.object({
  ok: z.literal(true),
  counts: mockupCountsSchema,
  documentHash: z.string(),
})

// --- Phase 2: studio save (full-document PUT) ---

export const mockupDocumentPutRequestSchema = z.object({
  document: z.unknown().describe('The full mockup document (schema + registry validated server-side)'),
  baseHash: z
    .string()
    .min(1)
    .describe('documentHash the client loaded — mismatch with the on-disk hash yields 409'),
})

export const mockupDocumentPutResponseSchema = z.object({
  ok: z.literal(true),
  counts: mockupCountsSchema,
  documentHash: z.string(),
  contentHash: z.string(),
})

// --- Phase 2: versions + diff ---

export const mockupVersionsResponseSchema = z.object({
  versions: z.array(z.object({ label: z.string(), createdAt: z.string() })),
})

export const mockupSnapshotRequestSchema = z.object({
  label: z.string().min(1).max(64),
})

export const mockupSnapshotResponseSchema = z.object({
  ok: z.literal(true),
  label: z.string(),
})

export const mockupVersionDetailResponseSchema = z.object({
  document: z.unknown(),
  label: z.string(),
  documentHash: z.string(),
})

export const mockupDiffResponseSchema = z.object({
  slug: z.string(),
  from: z.string().describe("'current' or a snapshot label"),
  to: z.string().describe("'current' or a snapshot label"),
  added: z.array(z.string()),
  removed: z.array(z.string()),
  changed: z.array(z.object({ id: z.string(), fields: z.array(z.string()) })),
  moved: z.array(z.string()),
})

// --- Phase 2: share links ---

export const mockupShareRequestSchema = z.object({
  expiresInDays: z.number().int().min(1).max(30).optional(),
})

export const mockupShareResponseSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
})

export const mockupSharedViewResponseSchema = z.object({
  document: z.unknown(),
  coverage: z.object({
    totals: mockupCountsSchema,
    userStories: z.array(z.string()),
    findings: mockupFindingsSummarySchema,
  }),
  contentHash: z.string(),
  copy: z.unknown().nullable(),
})
