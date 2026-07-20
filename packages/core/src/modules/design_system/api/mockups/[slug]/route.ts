import { NextResponse } from 'next/server'
import { getMockupBySlug } from '../../../mockups/loader'
import { designSystemTag, mockupDetailResponseSchema, mockupErrorSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['design_system.view'] },
} as const

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const mockup = getMockupBySlug(slug)
  if (!mockup) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!mockup.document) {
    return NextResponse.json(
      { error: 'Mockup document is invalid', issues: mockup.issues ?? [] },
      { status: 422 },
    )
  }
  return NextResponse.json({
    document: mockup.document,
    counts: mockup.counts,
    documentHash: mockup.documentHash,
  })
}

export const openApi = {
  GET: {
    summary: 'Get a design mockup document',
    description:
      'Returns the zod-validated mockup document with per-status counts and the on-disk content hash. 404 for unknown slugs, 422 with zod issues for invalid files.',
    tags: [designSystemTag],
    responses: {
      200: {
        description: 'Mockup document',
        content: { 'application/json': { schema: mockupDetailResponseSchema } },
      },
      404: {
        description: 'Unknown slug',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
      422: {
        description: 'Document fails schema validation',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
    },
  },
}
