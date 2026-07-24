import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { getMockupBySlug, mockupWritesEnabled } from '../../../../mockups/loader'
import { createSnapshot, listSnapshots } from '../../../../mockups/snapshots'
import {
  designSystemTag,
  mockupErrorSchema,
  mockupSnapshotRequestSchema,
  mockupSnapshotResponseSchema,
  mockupVersionsResponseSchema,
} from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['design_system.view'] },
  POST: { requireAuth: true, requireFeatures: ['design_system.mockups.manage'] },
} as const

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const mockup = getMockupBySlug(slug)
  if (!mockup) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const versions = listSnapshots(slug).map(({ label, createdAt }) => ({ label, createdAt }))
  return NextResponse.json({ versions })
}

/**
 * Studio snapshot action (spec: `yarn ds:mockups:snapshot <slug> <label>` "also
 * a studio action") — same dev-mode write contract as every other mockup write:
 * 404 outside development, snapshot path contained in the working tree.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!mockupWritesEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { slug } = await params
  let body: unknown = null
  try {
    body = await req.json()
  } catch {
    body = null
  }
  const parsed = mockupSnapshotRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const result = createSnapshot(slug, parsed.data.label)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ok: true, label: result.label })
}

export const openApi = {
  GET: {
    summary: 'List snapshot versions of a design mockup',
    tags: [designSystemTag],
    responses: {
      200: {
        description: 'Snapshot labels with creation timestamps',
        content: { 'application/json': { schema: mockupVersionsResponseSchema } },
      },
      404: {
        description: 'Unknown slug',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
    },
  },
  POST: {
    summary: 'Create a named snapshot of a design mockup (development only)',
    description:
      'Copies the current on-disk document to .ai/mockups/versions/<slug>@<label>.mockup.json. Available exclusively in development; 404 otherwise. 409 when the label already exists.',
    tags: [designSystemTag],
    requestBody: {
      content: { 'application/json': { schema: mockupSnapshotRequestSchema } },
    },
    responses: {
      200: {
        description: 'Snapshot created',
        content: { 'application/json': { schema: mockupSnapshotResponseSchema } },
      },
      404: {
        description: 'Unknown slug, or the app is not running in development',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
      409: {
        description: 'Snapshot label already exists',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
      422: {
        description: 'Invalid label or invalid source document',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
    },
  },
}
