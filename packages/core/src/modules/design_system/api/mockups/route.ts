import { NextResponse } from 'next/server'
import { loadMockups } from '../../mockups/loader'
import { designSystemTag, mockupListResponseSchema } from './openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['design_system.view'] },
} as const

export async function GET() {
  const items = loadMockups().map((mockup) => ({
    slug: mockup.slug,
    title: mockup.title,
    source: mockup.source,
    counts: mockup.counts,
    userStories: mockup.userStories,
    findingsCount: mockup.findings.total,
    draft: mockup.draft,
    modifiedAt: mockup.modifiedAt,
  }))
  return NextResponse.json({ items })
}

export const openApi = {
  GET: {
    summary: 'List design mockup documents',
    description:
      'Lists every discovered *.mockup.json document (spec-stage .ai/mockups plus module-local mockups) with per-status block counts and user-story tags.',
    tags: [designSystemTag],
    responses: {
      200: {
        description: 'Mockup list',
        content: {
          'application/json': { schema: mockupListResponseSchema },
        },
      },
    },
  },
}
