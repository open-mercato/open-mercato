import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Attachment, AttachmentPartition } from '../../data/entities'
import { ensureDefaultPartitions, DEFAULT_ATTACHMENT_PARTITIONS, sanitizePartitionCode, isPartitionSettingsLocked } from '../../lib/partitions'
import { resolvePartitionEnvKey } from '../../lib/partitionEnv'
import type { EntityManager } from '@mikro-orm/postgresql'

const partitionBaseSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[A-Za-z0-9_-]+$/, 'Invalid code. Use letters, numbers, dashes, or underscores.'),
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  isPublic: z.boolean().optional(),
})

const partitionUpdateSchema = partitionBaseSchema.extend({
  id: z.string().uuid(),
})

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
  const parsed = partitionBaseSchema.safeParse(json)
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
