import { NextResponse } from 'next/server'
import { loadSnapshot } from '../../../../../mockups/snapshots'
import {
  designSystemTag,
  mockupErrorSchema,
  mockupVersionDetailResponseSchema,
} from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['design_system.view'] },
} as const

/** Snapshot document fetch — the diff view renders snapshots side by side. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; label: string }> },
) {
  const { slug, label } = await params
  const snapshot = loadSnapshot(slug, label)
  if (!snapshot) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!snapshot.document) {
    return NextResponse.json(
      { error: 'Snapshot document is invalid', issues: snapshot.issues ?? [] },
      { status: 422 },
    )
  }
  return NextResponse.json({
    document: snapshot.document,
    label,
    documentHash: snapshot.documentHash,
  })
}

export const openApi = {
  GET: {
    summary: 'Get one snapshot version of a design mockup',
    tags: [designSystemTag],
    responses: {
      200: {
        description: 'Snapshot document',
        content: { 'application/json': { schema: mockupVersionDetailResponseSchema } },
      },
      404: {
        description: 'Unknown slug or label',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
      422: {
        description: 'Snapshot fails schema validation',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
    },
  },
}
