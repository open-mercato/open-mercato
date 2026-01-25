import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { RecordsIncomingShipment } from '../../data/entities'
import {
  incomingShipmentCreateSchema,
  incomingShipmentUpdateSchema,
  incomingShipmentStatusSchema,
  incomingShipmentDeliveryMethodSchema,
  accessLevelSchema,
  mappingCoverageSchema,
} from '../../data/validators'
import { createPagedListResponseSchema, createRecordsCrudOpenApi, defaultOkResponseSchema } from '../openapi'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['records.incoming_shipments.view'] },
  POST: { requireAuth: true, requireFeatures: ['records.incoming_shipments.create'] },
  PUT: { requireAuth: true, requireFeatures: ['records.incoming_shipments.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['records.incoming_shipments.delete'] },
}

export const metadata = routeMetadata

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    status: incomingShipmentStatusSchema.optional(),
    receivingOrgUnitId: z.string().uuid().optional(),
    receivedFrom: z.string().optional(),
    receivedTo: z.string().optional(),
  })
  .passthrough()

type IncomingShipmentRow = {
  id: string
  receivingOrgUnitId: string
  receivingOrgUnitSymbol: string
  subject: string
  senderId: string | null
  senderDisplayName: string | null
  senderAnonymous: boolean
  deliveryMethod: string
  status: string
  receivedAt: string | null
  rpwNumber: string | null
  rpwSequence: number | null
  attachmentIds: string[]
  postedAt: string | null
  senderReference: string | null
  remarks: string | null
  documentDate: string | null
  noDocumentDate: boolean
  documentSign: string | null
  noDocumentSign: boolean
  accessLevel: string
  hasChronologicalRegistration: boolean
  mappingCoverage: string
  isActive: boolean
  createdAt: string | null
  updatedAt: string | null
}

function toRow(entity: RecordsIncomingShipment): IncomingShipmentRow {
  return {
    id: String(entity.id),
    receivingOrgUnitId: String(entity.receivingOrgUnitId),
    receivingOrgUnitSymbol: String(entity.receivingOrgUnitSymbol),
    subject: String(entity.subject),
    senderId: entity.senderId ?? null,
    senderDisplayName: entity.senderDisplayName ?? null,
    senderAnonymous: !!entity.senderAnonymous,
    deliveryMethod: String(entity.deliveryMethod),
    status: String(entity.status),
    receivedAt: entity.receivedAt ? entity.receivedAt.toISOString() : null,
    rpwNumber: entity.rpwNumber ?? null,
    rpwSequence: entity.rpwSequence ?? null,
    attachmentIds: Array.isArray(entity.attachmentIds) ? entity.attachmentIds.map(String) : [],
    postedAt: entity.postedAt ? entity.postedAt.toISOString() : null,
    senderReference: entity.senderReference ?? null,
    remarks: entity.remarks ?? null,
    documentDate: entity.documentDate ? entity.documentDate.toISOString() : null,
    noDocumentDate: !!entity.noDocumentDate,
    documentSign: entity.documentSign ?? null,
    noDocumentSign: !!entity.noDocumentSign,
    accessLevel: String(entity.accessLevel),
    hasChronologicalRegistration: !!entity.hasChronologicalRegistration,
    mappingCoverage: String(entity.mappingCoverage),
    isActive: !!entity.isActive,
    createdAt: entity.createdAt ? entity.createdAt.toISOString() : null,
    updatedAt: entity.updatedAt ? entity.updatedAt.toISOString() : null,
  }
}

export async function GET(request: Request) {
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const auth = await getAuthFromRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const tenantId = auth.tenantId
  const organizationId = scope?.selectedId ?? auth.orgId
  if (!tenantId || !organizationId) {
    return NextResponse.json({ error: 'Missing tenant or organization context' }, { status: 400 })
  }

  const url = new URL(request.url)
  const parsed = listSchema.safeParse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    receivingOrgUnitId: url.searchParams.get('receivingOrgUnitId') ?? undefined,
    receivedFrom: url.searchParams.get('receivedFrom') ?? undefined,
    receivedTo: url.searchParams.get('receivedTo') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  }

  const { page, pageSize, search, status, receivingOrgUnitId, receivedFrom, receivedTo } = parsed.data

  const where: FilterQuery<RecordsIncomingShipment> = {
    organizationId,
    tenantId,
    deletedAt: null,
  }

  if (status) where.status = status
  if (receivingOrgUnitId) where.receivingOrgUnitId = receivingOrgUnitId

  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`
    where.$or = [
      { subject: { $ilike: pattern } },
      { senderDisplayName: { $ilike: pattern } },
      { rpwNumber: { $ilike: pattern } },
    ]
  }

  const receivedRange: Record<string, Date> = {}
  if (receivedFrom) {
    const from = new Date(receivedFrom)
    if (!Number.isNaN(from.getTime())) receivedRange.$gte = from
  }
  if (receivedTo) {
    const to = new Date(receivedTo)
    if (!Number.isNaN(to.getTime())) receivedRange.$lte = to
  }
  if (Object.keys(receivedRange).length) where.receivedAt = receivedRange as any

  const offset = (page - 1) * pageSize
  const [items, total] = await em.findAndCount(RecordsIncomingShipment, where, {
    orderBy: { createdAt: 'DESC' },
    limit: pageSize,
    offset,
  })

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return NextResponse.json({ items: items.map(toRow), total, page, pageSize, totalPages })
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: RecordsIncomingShipment,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  create: {
    schema: incomingShipmentCreateSchema,
    mapToEntity: (input) => {
      const normalized = {
        ...input,
        senderAnonymous: input.senderAnonymous === true,
        status: 'draft',
        accessLevel: input.accessLevel ?? 'public',
        mappingCoverage: input.mappingCoverage ?? 'none',
        hasChronologicalRegistration: input.hasChronologicalRegistration === true,
        isActive: input.isActive !== false,
        attachmentIds: Array.isArray(input.attachmentIds) ? input.attachmentIds : [],
      }
      return normalized
    },
    response: (entity) => ({ id: String(entity?.id ?? null) }),
  },
  update: {
    schema: incomingShipmentUpdateSchema,
    applyToEntity: (entity: RecordsIncomingShipment, input) => {
      if (input.receivingOrgUnitId !== undefined) entity.receivingOrgUnitId = input.receivingOrgUnitId
      if (input.receivingOrgUnitSymbol !== undefined) entity.receivingOrgUnitSymbol = input.receivingOrgUnitSymbol
      if (input.subject !== undefined) entity.subject = input.subject
      if (input.senderId !== undefined) entity.senderId = input.senderId
      if (input.senderDisplayName !== undefined) entity.senderDisplayName = input.senderDisplayName
      if (input.senderAnonymous !== undefined) entity.senderAnonymous = input.senderAnonymous
      if (input.deliveryMethod !== undefined) entity.deliveryMethod = input.deliveryMethod
      if (input.receivedAt !== undefined) entity.receivedAt = input.receivedAt
      if (input.attachmentIds !== undefined) entity.attachmentIds = input.attachmentIds
      if (input.postedAt !== undefined) entity.postedAt = input.postedAt
      if (input.senderReference !== undefined) entity.senderReference = input.senderReference
      if (input.remarks !== undefined) entity.remarks = input.remarks
      if (input.documentDate !== undefined) entity.documentDate = input.documentDate
      if (input.noDocumentDate !== undefined) entity.noDocumentDate = input.noDocumentDate
      if (input.documentSign !== undefined) entity.documentSign = input.documentSign
      if (input.noDocumentSign !== undefined) entity.noDocumentSign = input.noDocumentSign
      if (input.accessLevel !== undefined) entity.accessLevel = input.accessLevel
      if (input.hasChronologicalRegistration !== undefined) entity.hasChronologicalRegistration = input.hasChronologicalRegistration
      if (input.mappingCoverage !== undefined) entity.mappingCoverage = input.mappingCoverage
      if (input.isActive !== undefined) entity.isActive = input.isActive
    },
    response: () => ({ ok: true }),
  },
  del: {
    response: () => ({ ok: true }),
  },
})

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const incomingShipmentListItemSchema = z.object({
  id: z.string().uuid(),
  receivingOrgUnitId: z.string().uuid(),
  receivingOrgUnitSymbol: z.string(),
  subject: z.string(),
  senderId: z.string().uuid().nullable(),
  senderDisplayName: z.string().nullable(),
  senderAnonymous: z.boolean(),
  deliveryMethod: incomingShipmentDeliveryMethodSchema,
  status: incomingShipmentStatusSchema,
  receivedAt: z.string().nullable(),
  rpwNumber: z.string().nullable(),
  rpwSequence: z.number().nullable(),
  attachmentIds: z.array(z.string().uuid()),
  postedAt: z.string().nullable(),
  senderReference: z.string().nullable(),
  remarks: z.string().nullable(),
  documentDate: z.string().nullable(),
  noDocumentDate: z.boolean(),
  documentSign: z.string().nullable(),
  noDocumentSign: z.boolean(),
  accessLevel: accessLevelSchema,
  hasChronologicalRegistration: z.boolean(),
  mappingCoverage: mappingCoverageSchema,
  isActive: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const openApi = createRecordsCrudOpenApi({
  resourceName: 'Incoming shipment',
  pluralName: 'Incoming shipments',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(incomingShipmentListItemSchema),
  create: {
    schema: incomingShipmentCreateSchema,
    description: 'Creates an incoming shipment in draft status. RPW number is assigned via the register action.',
  },
  update: {
    schema: incomingShipmentUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an incoming shipment by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an incoming shipment by id.',
  },
})
