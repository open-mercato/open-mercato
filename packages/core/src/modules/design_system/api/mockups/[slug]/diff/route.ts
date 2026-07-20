import { NextResponse } from 'next/server'
import { computeMockupDiff } from '../../../../mockups/diff'
import { getMockupBySlug } from '../../../../mockups/loader'
import { loadSnapshot } from '../../../../mockups/snapshots'
import type { MockupDocument } from '../../../../mockups/schema'
import { designSystemTag, mockupDiffResponseSchema, mockupErrorSchema } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['design_system.view'] },
} as const

function resolveVersion(slug: string, ref: string): MockupDocument | null {
  if (ref === 'current') {
    const mockup = getMockupBySlug(slug)
    return mockup?.document ?? null
  }
  const snapshot = loadSnapshot(slug, ref)
  return snapshot?.document ?? null
}

/**
 * Block-level delta between two versions (`from`/`to` = `current` or a
 * snapshot label; defaults: from=oldest meaningful choice is not guessed —
 * both parameters are required except `to`, which defaults to `current`).
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const url = new URL(req.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to') ?? 'current'
  if (!from) {
    return NextResponse.json({ error: 'Missing "from" query parameter' }, { status: 400 })
  }
  const fromDocument = resolveVersion(slug, from)
  const toDocument = resolveVersion(slug, to)
  if (!fromDocument || !toDocument) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(computeMockupDiff(fromDocument, toDocument, { slug, from, to }))
}

export const openApi = {
  GET: {
    summary: 'Block-level delta between two versions of a design mockup',
    description:
      'Computes added/removed/changed/moved block ids by node id between two versions. `from` is required; `to` defaults to `current`. Both accept `current` or a snapshot label.',
    tags: [designSystemTag],
    responses: {
      200: {
        description: 'Mockup diff',
        content: { 'application/json': { schema: mockupDiffResponseSchema } },
      },
      400: {
        description: 'Missing from parameter',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
      404: {
        description: 'Unknown slug or version label',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
    },
  },
}
