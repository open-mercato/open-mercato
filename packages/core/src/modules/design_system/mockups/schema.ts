import { z } from 'zod'

/**
 * Mockup document schema — spec `.ai/specs/2026-07-05-ds-live-mockup-composer.md`,
 * Phase 1 core. A mockup is screen metadata plus a layout tree of `stack` /
 * `columns` containers whose leaves are `block` nodes (each referencing a
 * gallery registry entry) or `placeholder` nodes (dashed labeled boxes for
 * blocks with no registry entry yet).
 *
 * Phase 2/3 additions (findings, draft flag, promotion hints) are strictly
 * optional extensions on `version: 1` — a Phase-1-core document must validate
 * forever (pinned by the schema BC test).
 */

export const MOCKUP_STATUSES = ['implemented', 'proposed', 'om-default'] as const
export type MockupStatus = (typeof MOCKUP_STATUSES)[number]

export const MOCKUP_WIDTHS = ['desktop', 'tablet', 'mobile'] as const
export type MockupWidth = (typeof MOCKUP_WIDTHS)[number]

/** Prop keys a mockup may never pass — a mockup cannot restyle a component past the DS. */
export const FORBIDDEN_PROP_KEYS = ['className', 'style', 'dangerouslySetInnerHTML'] as const

const USER_STORY_PATTERN = /^US-[A-Za-z0-9._-]+$/

export const blockAnnotation = z.object({
  status: z.enum(MOCKUP_STATUSES),
  userStory: z.string().regex(USER_STORY_PATTERN).optional(),
  note: z.string().max(500).optional(),
})
export type MockupBlockAnnotation = z.infer<typeof blockAnnotation>

const blockProps = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  for (const key of FORBIDDEN_PROP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      ctx.addIssue({
        code: 'custom',
        message: `Forbidden prop key "${key}" — mockup props cannot restyle components past the DS`,
        path: [key],
      })
    }
  }
})

export const blockNode = z
  .object({
    type: z.literal('block'),
    id: z.string().min(1),
    entry: z.string().min(1), // GalleryEntry.id — resolved against the gallery registry
    variant: z.string().min(1).optional(), // GalleryVariant.id within that entry
    props: blockProps.optional(), // sample data; only valid on entries exposing `compose`
  })
  .extend(blockAnnotation.shape)
export type MockupBlockNode = z.infer<typeof blockNode>

export const placeholderNode = z
  .object({
    type: z.literal('placeholder'),
    id: z.string().min(1),
    label: z.string().min(1), // what would be here
  })
  .extend(blockAnnotation.shape) // placeholders are almost always 'proposed'
export type MockupPlaceholderNode = z.infer<typeof placeholderNode>

export type MockupStackNode = {
  type: 'stack'
  id: string
  gap?: 2 | 4 | 6 | 8
  children: MockupLayoutNode[]
}

export type MockupColumnsNode = {
  type: 'columns'
  id: string
  weights: number[]
  children: MockupLayoutNode[]
}

export type MockupLayoutNode =
  | MockupBlockNode
  | MockupPlaceholderNode
  | MockupStackNode
  | MockupColumnsNode

const stackNode: z.ZodType<MockupStackNode> = z.lazy(() =>
  z.object({
    type: z.literal('stack'),
    id: z.string().min(1),
    gap: z.union([z.literal(2), z.literal(4), z.literal(6), z.literal(8)]).optional(),
    children: z.array(layoutNode),
  }),
)

const columnsNode: z.ZodType<MockupColumnsNode> = z.lazy(() =>
  z.object({
    type: z.literal('columns'),
    id: z.string().min(1),
    weights: z.array(z.number().positive()).min(1),
    children: z.array(layoutNode),
  }),
)

export const layoutNode: z.ZodType<MockupLayoutNode> = z.lazy(() =>
  z.union([blockNode, placeholderNode, stackNode, columnsNode]),
)

export const mockupDocument = z
  .object({
    version: z.literal(1),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(1),
    description: z.string().optional(),
    routeHint: z.string().optional(), // '/backend/customers/people' — informational only
    width: z.enum(MOCKUP_WIDTHS).default('desktop'),
    spec: z.string().optional(), // relative path to the owning spec document
    root: layoutNode,
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>()
    for (const node of collectNodes(doc.root)) {
      if (seen.has(node.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate node id "${node.id}" — node ids must be unique within a mockup`,
          path: ['root'],
        })
      }
      seen.add(node.id)
    }
  })
export type MockupDocument = z.infer<typeof mockupDocument>

// ---------------------------------------------------------------------------
// Tree walks — counts and user stories are data walks over the same tree the
// renderer draws; keep them here (no fs, no React) so server, client, and
// tests share one implementation.
// ---------------------------------------------------------------------------

export type MockupLeafNode = MockupBlockNode | MockupPlaceholderNode

export function collectNodes(root: MockupLayoutNode): MockupLayoutNode[] {
  const nodes: MockupLayoutNode[] = [root]
  if (root.type === 'stack' || root.type === 'columns') {
    for (const child of root.children) nodes.push(...collectNodes(child))
  }
  return nodes
}

export function collectLeaves(root: MockupLayoutNode): MockupLeafNode[] {
  return collectNodes(root).filter(
    (node): node is MockupLeafNode => node.type === 'block' || node.type === 'placeholder',
  )
}

export type MockupCounts = {
  implemented: number
  proposed: number
  omDefault: number
  placeholder: number
}

/**
 * Per-status block counts. Placeholders are tracked separately regardless of
 * their annotation status so they never masquerade as DS-true content.
 */
export function computeCounts(document: MockupDocument): MockupCounts {
  const counts: MockupCounts = { implemented: 0, proposed: 0, omDefault: 0, placeholder: 0 }
  for (const leaf of collectLeaves(document.root)) {
    if (leaf.type === 'placeholder') {
      counts.placeholder += 1
    } else if (leaf.status === 'implemented') {
      counts.implemented += 1
    } else if (leaf.status === 'proposed') {
      counts.proposed += 1
    } else {
      counts.omDefault += 1
    }
  }
  return counts
}

/** Distinct user-story tags present in the document, in first-seen order. */
export function collectUserStories(document: MockupDocument): string[] {
  const stories: string[] = []
  for (const leaf of collectLeaves(document.root)) {
    if (leaf.userStory && !stories.includes(leaf.userStory)) stories.push(leaf.userStory)
  }
  return stories
}
