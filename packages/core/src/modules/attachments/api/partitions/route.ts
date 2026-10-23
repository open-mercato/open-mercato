import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Attachment, AttachmentPartition } from '../../data/entities'
import { ensureDefaultPartitions, DEFAULT_ATTACHMENT_PARTITIONS, sanitizePartitionCode, isPartitionSettingsLocked } from '../../lib/partitions'
import { resolvePartitionEnvKey } from '../../lib/partitionEnv'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveDefaultAttachmentOcrEnabled } from '../../lib/ocrConfig'
import {
  partitionCreateSchema,
  partitionUpdateSchema,
  isDocumentStructureFlagCombinationValid,
  DOCUMENT_SECTIONS_REQUIRE_STRUCTURE_MESSAGE,
} from '../../data/validators'
import {
  attachmentsTag,
  partitionResponseSchema,
  partitionListResponseSchema,
  attachmentErrorSchema,
} from '../openapi'

const deleteSchema = z.object({
  id: z.string().uuid(),
})

const DEFAULT_CODES = new Set(DEFAULT_ATTACHMENT_PARTITIONS.map((entry) => entry.code))

type AuthLike = { sub?: string; tenantId?: string | null; orgId?: string | null; isSuperAdmin?: boolean } | null | undefined

function invalidPayloadResponse(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.')
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return NextResponse.json({ error: 'Invalid payload', fieldErrors }, { status: 400 })
}

function isSuperAdmin(auth: AuthLike): boolean {
  return auth?.isSuperAdmin === true
}

function canManagePartition(auth: AuthLike, entry: AttachmentPartition): boolean {
  if (!auth?.tenantId) return false
  if (entry.tenantId && entry.tenantId === auth.tenantId) return true
  if (entry.tenantId == null && isSuperAdmin(auth)) return true
  return false
}

function partitionVisibilityFilter(auth: AuthLike) {
  if (isSuperAdmin(auth)) return {}
  return { $or: [{ tenantId: null }, { tenantId: auth?.tenantId ?? null }] }
}

function serializePartition(entry: AttachmentPartition) {
  return {
    id: entry.id,
    code: entry.code,
    title: entry.title,
    description: entry.description ?? null,
    isPublic: entry.isPublic ?? false,
    requiresOcr: entry.requiresOcr ?? resolveDefaultAttachmentOcrEnabled(),
    ocrModel: entry.ocrModel ?? null,
    storageDriver: entry.storageDriver ?? 'local',
    configJson: entry.configJson ?? null,
    extractDocumentStructure: entry.extractDocumentStructure ?? false,
    indexDocumentSections: entry.indexDocumentSections ?? false,
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
  if (!auth?.sub || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const em = await resolveEm()
  await ensureDefaultPartitions(em)
  const rows = await findWithDecryption<AttachmentPartition>(
    em,
    AttachmentPartition,
    partitionVisibilityFilter(auth),
    { orderBy: { createdAt: 'asc' } },
    { tenantId: auth.tenantId, organizationId: auth.orgId ?? null },
  )
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
  if (!auth?.sub || !auth.tenantId) {
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
    return invalidPayloadResponse(parsed.error)
  }
  const code = sanitizePartitionCode(parsed.data.code)
  if (!code) {
    return NextResponse.json({ error: 'Partition code is required.' }, { status: 400 })
  }
  const em = await resolveEm()
  await ensureDefaultPartitions(em)
  const exists = await findOneWithDecryption(
    em,
    AttachmentPartition,
    { code },
    undefined,
    { tenantId: auth.tenantId, organizationId: auth.orgId ?? null },
  )
  if (exists) {
    return NextResponse.json({ error: 'Partition code already exists.' }, { status: 409 })
  }
  const entry = em.create(AttachmentPartition, {
    code,
    title: parsed.data.title.trim(),
    description: parsed.data.description?.trim() ?? null,
    storageDriver: parsed.data.storageDriver ?? 'local',
    configJson: parsed.data.configJson ?? null,
    isPublic: parsed.data.isPublic ?? false,
    requiresOcr:
      typeof parsed.data.requiresOcr === 'boolean'
        ? parsed.data.requiresOcr
        : resolveDefaultAttachmentOcrEnabled(),
    ocrModel: parsed.data.ocrModel?.trim() || null,
    extractDocumentStructure: parsed.data.extractDocumentStructure,
    indexDocumentSections: parsed.data.indexDocumentSections,
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
  })
  await em.persist(entry).flush()
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
  if (!auth?.sub || !auth.tenantId) {
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
    return invalidPayloadResponse(parsed.error)
  }
  const em = await resolveEm()
  const entry = await findOneWithDecryption(
    em,
    AttachmentPartition,
    { id: parsed.data.id },
    undefined,
    { tenantId: auth.tenantId, organizationId: auth.orgId ?? null },
  )
  if (!entry || !canManagePartition(auth, entry)) {
    return NextResponse.json({ error: 'Partition not found' }, { status: 404 })
  }
  if (sanitizePartitionCode(parsed.data.code) !== entry.code) {
    return NextResponse.json({ error: 'Partition code cannot be changed.' }, { status: 400 })
  }
  const nextDocumentStructureFlags = {
    extractDocumentStructure: parsed.data.extractDocumentStructure ?? entry.extractDocumentStructure ?? false,
    indexDocumentSections: parsed.data.indexDocumentSections ?? entry.indexDocumentSections ?? false,
  }
  if (!isDocumentStructureFlagCombinationValid(nextDocumentStructureFlags)) {
    return NextResponse.json(
      {
        error: 'Invalid payload',
        fieldErrors: { indexDocumentSections: DOCUMENT_SECTIONS_REQUIRE_STRUCTURE_MESSAGE },
      },
      { status: 400 },
    )
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
  if (parsed.data.storageDriver !== undefined) {
    entry.storageDriver = parsed.data.storageDriver
  }
  if (parsed.data.configJson !== undefined) {
    entry.configJson = parsed.data.configJson ?? null
  }
  entry.extractDocumentStructure = nextDocumentStructureFlags.extractDocumentStructure
  entry.indexDocumentSections = nextDocumentStructureFlags.indexDocumentSections
  await em.persist(entry).flush()
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
  if (!auth?.sub || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  const parsed = deleteSchema.safeParse({ id })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Partition id is required' }, { status: 400 })
  }
  const em = await resolveEm()
  const entry = await findOneWithDecryption(
    em,
    AttachmentPartition,
    { id: parsed.data.id },
    undefined,
    { tenantId: auth.tenantId, organizationId: auth.orgId ?? null },
  )
  if (!entry || !canManagePartition(auth, entry)) {
    return NextResponse.json({ error: 'Partition not found' }, { status: 404 })
  }
  if (DEFAULT_CODES.has(entry.code)) {
    return NextResponse.json({ error: 'Default partitions cannot be removed.' }, { status: 400 })
  }
  const usageFilter: Record<string, unknown> = { partitionCode: entry.code }
  if (entry.tenantId) usageFilter.tenantId = entry.tenantId
  const usage = await em.count(Attachment, usageFilter)
  if (usage > 0) {
    return NextResponse.json({ error: 'Partition is in use and cannot be removed.' }, { status: 409 })
  }
  await em.remove(entry).flush()
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
      description: 'Creates a new attachment partition with specified storage, OCR and document structure settings. Requires unique partition code. indexDocumentSections requires extractDocumentStructure.',
      requestBody: {
        contentType: 'application/json',
        schema: partitionCreateSchema,
      },
      responses: [
        { status: 201, description: 'Partition created successfully', schema: partitionResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload, partition code, or document structure flag combination', schema: attachmentErrorSchema },
        { status: 401, description: 'Unauthorized', schema: attachmentErrorSchema },
        { status: 403, description: 'Partitions locked in demo mode', schema: attachmentErrorSchema },
        { status: 409, description: 'Partition code already exists', schema: attachmentErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update partition',
      description: 'Updates an existing partition. Partition code cannot be changed. Title, description, OCR settings, document structure settings, and access control can be modified. Omitted document structure flags keep their current values; indexDocumentSections requires extractDocumentStructure.',
      requestBody: {
        contentType: 'application/json',
        schema: partitionUpdateSchema,
      },
      responses: [
        { status: 200, description: 'Partition updated successfully', schema: partitionResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload, code change attempt, or document structure flag combination', schema: attachmentErrorSchema },
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
