import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Attachment, AttachmentPartition } from '../../data/entities'
import { ensureDefaultPartitions, DEFAULT_ATTACHMENT_PARTITIONS, sanitizePartitionCode, isPartitionSettingsLocked } from '../../lib/partitions'
import { resolvePartitionEnvKey } from '../../lib/partitionEnv'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveDefaultAttachmentOcrEnabled } from '../../lib/ocrConfig'
import {
  attachmentsTag,
  partitionCreateSchema,
  partitionUpdateSchema,
  partitionResponseSchema,
  partitionListResponseSchema,
  attachmentErrorSchema,
} from '../openapi'

const deleteSchema = z.object({
  id: z.string().uuid(),
})

const DEFAULT_CODES = new Set(DEFAULT_ATTACHMENT_PARTITIONS.map((entry) => entry.code))

function serializePartition(entry: AttachmentPartition) {
  return {
    id: entry.id,
    code: entry.code,
    title: entry.title,
    description: entry.description ?? null,
    isPublic: entry.isPublic ?? false,
    requiresOcr: entry.requiresOcr ?? resolveDefaultAttachmentOcrEnabled(),
    ocrModel: entry.ocrModel ?? null,
    createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : null,
    updatedAt: entry.updatedAt instanceof Date ? entry.updatedAt.toISOString() : null,
    envKey: resolvePartitionEnvKey(entry.code),
  }
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['attachments.manage'] },
  POST: { requireAuth: true, requireFeatures: ['attachments.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['attachments.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['attachments.manage'] },
} as const

async function resolveEm() {
  const { resolve } = await createRequestContainer()
  return resolve('em') as EntityManager
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const em = await resolveEm()
  await ensureDefaultPartitions(em)
  const rows = await em.find(AttachmentPartition, {}, { orderBy: { createdAt: 'asc' } })
  return NextResponse.json({ items: rows.map((entry) => serializePartition(entry)) })
}

export async function POST(req: Request) {
  if (isPartitionSettingsLocked()) {
    return NextResponse.json(
      { error: 'Attachment partitions are managed by the environment in demo/onboarding mode.' },
      { status: 403 },
    )
  }
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let json: unknown = null
  try {
    json = await req.json()
  } catch {
    json = null
  }
  const parsed = partitionCreateSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const code = sanitizePartitionCode(parsed.data.code)
  if (!code) {
    return NextResponse.json({ error: 'Partition code is required.' }, { status: 400 })
  }
  const em = await resolveEm()
  await ensureDefaultPartitions(em)
  const exists = await em.findOne(AttachmentPartition, { code })
  if (exists) {
    return NextResponse.json({ error: 'Partition code already exists.' }, { status: 409 })
  }
  const entry = em.create(AttachmentPartition, {
    code,
    title: parsed.data.title.trim(),
    description: parsed.data.description?.trim() ?? null,
    storageDriver: 'local',
    isPublic: parsed.data.isPublic ?? false,
    requiresOcr:
      typeof parsed.data.requiresOcr === 'boolean'
        ? parsed.data.requiresOcr
        : resolveDefaultAttachmentOcrEnabled(),
    ocrModel: parsed.data.ocrModel?.trim() || null,
  })
  await em.persistAndFlush(entry)
  return NextResponse.json({ item: serializePartition(entry) }, { status: 201 })
}

export async function PUT(req: Request) {
  if (isPartitionSettingsLocked()) {
    return NextResponse.json(
      { error: 'Attachment partitions are managed by the environment in demo/onboarding mode.' },
      { status: 403 },
    )
  }
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let json: unknown = null
  try {
    json = await req.json()
  } catch {
    json = null
  }
  const parsed = partitionUpdateSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const em = await resolveEm()
  const entry = await em.findOne(AttachmentPartition, { id: parsed.data.id })
  if (!entry) {
    return NextResponse.json({ error: 'Partition not found' }, { status: 404 })
  }
  if (sanitizePartitionCode(parsed.data.code) !== entry.code) {
    return NextResponse.json({ error: 'Partition code cannot be changed.' }, { status: 400 })
  }
  entry.title = parsed.data.title.trim()
  entry.description = parsed.data.description?.trim() ?? null
  entry.isPublic = parsed.data.isPublic ?? false
  if (typeof parsed.data.requiresOcr === 'boolean') {
    entry.requiresOcr = parsed.data.requiresOcr
  }
  if (parsed.data.ocrModel !== undefined) {
    entry.ocrModel = parsed.data.ocrModel?.trim() || null
  }
  await em.persistAndFlush(entry)
  return NextResponse.json({ item: serializePartition(entry) })
}

export async function DELETE(req: Request) {
  if (isPartitionSettingsLocked()) {
    return NextResponse.json(
      { error: 'Attachment partitions are managed by the environment in demo/onboarding mode.' },
      { status: 403 },
    )
  }
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  const parsed = deleteSchema.safeParse({ id })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Partition id is required' }, { status: 400 })
  }
  const em = await resolveEm()
  const entry = await em.findOne(AttachmentPartition, { id: parsed.data.id })
  if (!entry) {
    return NextResponse.json({ error: 'Partition not found' }, { status: 404 })
  }
  if (DEFAULT_CODES.has(entry.code)) {
    return NextResponse.json({ error: 'Default partitions cannot be removed.' }, { status: 400 })
  }
  const usage = await em.count(Attachment, { partitionCode: entry.code })
  if (usage > 0) {
    return NextResponse.json({ error: 'Partition is in use and cannot be removed.' }, { status: 409 })
  }
  await em.removeAndFlush(entry)
  return NextResponse.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: attachmentsTag,
  summary: 'Attachment partition management',
  methods: {
    GET: {
      summary: 'List all attachment partitions',
      description: 'Returns all configured attachment partitions with storage settings, OCR configuration, and access control settings.',
      responses: [
        { status: 200, description: 'List of partitions', schema: partitionListResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: attachmentErrorSchema },
      ],
    },
    POST: {
      summary: 'Create new partition',
      description: 'Creates a new attachment partition with specified storage and OCR settings. Requires unique partition code.',
      requestBody: {
        contentType: 'application/json',
        schema: partitionCreateSchema,
      },
      responses: [
        { status: 201, description: 'Partition created successfully', schema: partitionResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload or partition code', schema: attachmentErrorSchema },
        { status: 401, description: 'Unauthorized', schema: attachmentErrorSchema },
        { status: 403, description: 'Partitions locked in demo mode', schema: attachmentErrorSchema },
        { status: 409, description: 'Partition code already exists', schema: attachmentErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update partition',
      description: 'Updates an existing partition. Partition code cannot be changed. Title, description, OCR settings, and access control can be modified.',
      requestBody: {
        contentType: 'application/json',
        schema: partitionUpdateSchema,
      },
      responses: [
        { status: 200, description: 'Partition updated successfully', schema: partitionResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload or code change attempt', schema: attachmentErrorSchema },
        { status: 401, description: 'Unauthorized', schema: attachmentErrorSchema },
        { status: 403, description: 'Partitions locked in demo mode', schema: attachmentErrorSchema },
        { status: 404, description: 'Partition not found', schema: attachmentErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete partition',
      description: 'Deletes a partition. Default partitions cannot be deleted. Partitions with existing attachments cannot be deleted.',
      responses: [
        { status: 200, description: 'Partition deleted successfully', schema: z.object({ ok: z.literal(true) }) },
      ],
      errors: [
        { status: 400, description: 'Invalid ID or default partition deletion attempt', schema: attachmentErrorSchema },
        { status: 401, description: 'Unauthorized', schema: attachmentErrorSchema },
        { status: 403, description: 'Partitions locked in demo mode', schema: attachmentErrorSchema },
        { status: 404, description: 'Partition not found', schema: attachmentErrorSchema },
        { status: 409, description: 'Partition in use', schema: attachmentErrorSchema },
      ],
    },
  },
}
