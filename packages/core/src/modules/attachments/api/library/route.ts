import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment, AttachmentPartition } from '../../data/entities'
import { buildAttachmentImageUrl, slugifyAttachmentFileName } from '../../lib/imageUrls'
import { readAttachmentMetadata } from '../../lib/metadata'

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  search: z.string().optional(),
  partition: z.string().optional(),
  tags: z.string().optional(),
  sortField: z.enum(['fileName', 'fileSize', 'createdAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['attachments.view'] },
}

function buildTagFilter(raw?: string): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
}

function formatDateValue(value: unknown): string {
  const toDate = (): Date => {
    if (value instanceof Date) return value
    if (typeof value === 'string') {
      const parsed = new Date(value)
      if (!Number.isNaN(parsed.getTime())) return parsed
    }
    const fallback = new Date(value as any)
    if (!Number.isNaN(fallback.getTime())) return fallback
    return new Date()
  }
  return toDate().toISOString()
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  }

  const { page, pageSize, search, partition, tags, sortField, sortDir } = parsed.data
  const tagList = buildTagFilter(tags)
  const offset = (page - 1) * pageSize
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const qb = em.createQueryBuilder(Attachment, 'a')
  qb.where({
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  })
  if (search && search.trim().length > 0) {
    qb.andWhere({ fileName: { $ilike: `%${search.trim()}%` } })
  }
  if (partition && partition.trim().length > 0) {
    qb.andWhere({ partitionCode: partition.trim() })
  }
  if (tagList.length > 0) {
    qb.andWhere(`coalesce(a.storage_metadata->'tags', '[]'::jsonb) @> ?::jsonb`, [JSON.stringify(tagList)])
  }
  const countQb = qb.clone()
  const orderMap: Record<string, string> = {
    fileName: 'a.file_name',
    fileSize: 'a.file_size',
    createdAt: 'a.created_at',
  }
  const orderColumn = orderMap[sortField ?? 'createdAt'] ?? 'a.created_at'
  qb.orderBy({ [orderColumn]: sortDir === 'asc' ? 'asc' : 'desc' })
  qb.limit(pageSize).offset(offset)

  const partitionsPromise = em.find(
    AttachmentPartition,
    {},
    { orderBy: { title: 'asc' }, fields: ['code', 'title', 'description'] as any },
  )
  const [records, total, partitions] = await Promise.all([qb.getResultList(), countQb.count('a.id', true), partitionsPromise])
  const partitionTitleByCode = partitions.reduce<Record<string, string>>((acc, entry) => {
    if (entry.code) acc[entry.code] = entry.title ?? entry.code
    return acc
  }, {})
  const items = records.map((record) => {
    const metadata = readAttachmentMetadata(record.storageMetadata)
    const fileName = record.fileName || ''
    const isImage = typeof record.mimeType === 'string' && record.mimeType.toLowerCase().startsWith('image/')
    const thumbnailUrl = isImage
      ? buildAttachmentImageUrl(record.id, {
          width: 200,
          height: 200,
          slug: slugifyAttachmentFileName(fileName),
        })
      : undefined
    return {
      id: record.id,
      fileName,
      fileSize: record.fileSize,
      mimeType: record.mimeType,
      partitionCode: record.partitionCode,
      partitionTitle: partitionTitleByCode[record.partitionCode] ?? null,
      url: record.url,
      createdAt: formatDateValue(record.createdAt),
      tags: metadata.tags ?? [],
      assignments: metadata.assignments ?? [],
      thumbnailUrl,
    }
  })

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const knex = (em as any).getConnection().getKnex()
  const tagRows: Array<{ tag?: string | null }> = await knex
    .select(
      knex.raw(`distinct jsonb_array_elements_text(coalesce(storage_metadata->'tags', '[]'::jsonb)) as tag`),
    )
    .from('attachments')
    .where('organization_id', auth.orgId)
    .andWhere('tenant_id', auth.tenantId)
    .orderBy('tag', 'asc')
  const availableTags = tagRows
    .map((row) => (typeof row.tag === 'string' ? row.tag.trim() : ''))
    .filter((tag) => tag.length > 0)

  return NextResponse.json({
    items,
    page,
    pageSize,
    total,
    totalPages,
    availableTags,
    partitions: partitions.map((entry) => ({
      code: entry.code,
      title: entry.title,
      description: entry.description ?? null,
      isPublic: entry.isPublic ?? false,
    })),
  })
}
