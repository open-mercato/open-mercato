import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Contractor } from '../../../data/entities'
import { contractorCreateSchema } from '../../../data/validators'

const updateBodySchema = contractorCreateSchema.partial()

const paramsSchema = z.object({
  id: z.string().uuid(),
})

function buildScopeFilters(
  auth: { tenantId?: string | null; orgId?: string | null },
  scope: { tenantId?: string | null; selectedId?: string | null; filterIds?: string[] | null } | null
): { tenantId?: string; organizationId?: { $in: string[] } } {
  const filters: { tenantId?: string; organizationId?: { $in: string[] } } = {}

  if (typeof auth.tenantId === 'string') {
    filters.tenantId = auth.tenantId
  }

  const allowedOrgIds = new Set<string>()
  const filterIds = scope?.filterIds
  if (Array.isArray(filterIds) && filterIds.length > 0) {
    filterIds.forEach((id) => {
      if (typeof id === 'string') allowedOrgIds.add(id)
    })
  } else {
    const fallbackOrgId = scope?.selectedId ?? auth.orgId
    if (typeof fallbackOrgId === 'string') {
      allowedOrgIds.add(fallbackOrgId)
    }
  }

  if (allowedOrgIds.size > 0) {
    filters.organizationId = { $in: [...allowedOrgIds] }
  }

  return filters
}

export async function GET(req: Request, ctx: { params?: Promise<{ id?: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = await ctx.params
  const parse = paramsSchema.safeParse({ id: params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid contractor id' }, { status: 400 })

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const scopeFilters = buildScopeFilters(auth, scope)
  const filters: Record<string, unknown> = {
    id: parse.data.id,
    deletedAt: null,
    ...scopeFilters,
  }

  const contractor = await em.findOne(Contractor, filters, {
    populate: ['addresses', 'contacts', 'roles', 'roles.roleType', 'paymentTerms', 'creditLimit'],
  })

  if (!contractor) return NextResponse.json({ error: 'Contractor not found' }, { status: 404 })

  // Transform to response format
  const response = {
    id: contractor.id,
    name: contractor.name,
    shortName: contractor.shortName,
    code: contractor.code,
    parentId: contractor.parentId,
    taxId: contractor.taxId,
    legalName: contractor.legalName,
    registrationNumber: contractor.registrationNumber,
    isActive: contractor.isActive,
    createdAt: contractor.createdAt.toISOString(),
    updatedAt: contractor.updatedAt.toISOString(),
    addresses: contractor.addresses.getItems().map((addr) => ({
      id: addr.id,
      purpose: addr.purpose,
      label: addr.label,
      addressLine1: addr.addressLine1,
      addressLine2: addr.addressLine2,
      city: addr.city,
      state: addr.state,
      postalCode: addr.postalCode,
      countryCode: addr.countryCode,
      isPrimary: addr.isPrimary,
      isActive: addr.isActive,
      createdAt: addr.createdAt.toISOString(),
      updatedAt: addr.updatedAt.toISOString(),
    })),
    contacts: contractor.contacts.getItems().map((contact) => ({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      jobTitle: contact.jobTitle,
      department: contact.department,
      email: contact.email,
      phone: contact.phone,
      mobile: contact.mobile,
      isPrimary: contact.isPrimary,
      isActive: contact.isActive,
      notes: contact.notes,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
    })),
    roles: contractor.roles.getItems().map((role) => ({
      id: role.id,
      roleTypeId: role.roleType.id,
      roleTypeName: role.roleType.name,
      roleTypeCode: role.roleType.code,
      roleTypeColor: role.roleType.color,
      roleTypeCategory: role.roleType.category,
      isActive: role.isActive,
      effectiveFrom: role.effectiveFrom?.toISOString() ?? null,
      effectiveTo: role.effectiveTo?.toISOString() ?? null,
      settings: role.settings,
      createdAt: role.createdAt.toISOString(),
      updatedAt: role.updatedAt.toISOString(),
    })),
    paymentTerms: contractor.paymentTerms ? {
      id: contractor.paymentTerms.id,
      paymentDays: contractor.paymentTerms.paymentDays,
      paymentMethod: contractor.paymentTerms.paymentMethod,
      currencyCode: contractor.paymentTerms.currencyCode,
      bankName: contractor.paymentTerms.bankName,
      bankAccountNumber: contractor.paymentTerms.bankAccountNumber,
      bankRoutingNumber: contractor.paymentTerms.bankRoutingNumber,
      iban: contractor.paymentTerms.iban,
      swiftBic: contractor.paymentTerms.swiftBic,
      notes: contractor.paymentTerms.notes,
      createdAt: contractor.paymentTerms.createdAt.toISOString(),
      updatedAt: contractor.paymentTerms.updatedAt.toISOString(),
    } : null,
    creditLimit: contractor.creditLimit ? {
      id: contractor.creditLimit.id,
      creditLimit: contractor.creditLimit.creditLimit,
      currencyCode: contractor.creditLimit.currencyCode,
      isUnlimited: contractor.creditLimit.isUnlimited,
      currentExposure: contractor.creditLimit.currentExposure,
      lastCalculatedAt: contractor.creditLimit.lastCalculatedAt?.toISOString() ?? null,
      requiresApprovalAbove: contractor.creditLimit.requiresApprovalAbove,
      approvedById: contractor.creditLimit.approvedById,
      approvedAt: contractor.creditLimit.approvedAt?.toISOString() ?? null,
      notes: contractor.creditLimit.notes,
      createdAt: contractor.creditLimit.createdAt.toISOString(),
      updatedAt: contractor.creditLimit.updatedAt.toISOString(),
    } : null,
  }

  return NextResponse.json(response)
}

export async function PUT(req: Request, ctx: { params?: Promise<{ id?: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = await ctx.params
  const parse = paramsSchema.safeParse({ id: params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid contractor id' }, { status: 400 })

  const body = await req.json()
  const validation = updateBodySchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ error: 'Invalid input', details: validation.error }, { status: 400 })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const scopeFilters = buildScopeFilters(auth, scope)
  const filters: Record<string, unknown> = {
    id: parse.data.id,
    deletedAt: null,
    ...scopeFilters,
  }

  const contractor = await em.findOne(Contractor, filters)

  if (!contractor) return NextResponse.json({ error: 'Contractor not found' }, { status: 404 })

  const data = validation.data

  if (data.name !== undefined) contractor.name = data.name
  if (data.shortName !== undefined) contractor.shortName = data.shortName
  if (data.code !== undefined) contractor.code = data.code
  if (data.parentId !== undefined) contractor.parentId = data.parentId
  if (data.taxId !== undefined) contractor.taxId = data.taxId
  if (data.legalName !== undefined) contractor.legalName = data.legalName
  if (data.registrationNumber !== undefined) contractor.registrationNumber = data.registrationNumber

  contractor.updatedAt = new Date()

  await em.flush()

  return NextResponse.json({
    id: contractor.id,
    name: contractor.name,
    shortName: contractor.shortName,
    code: contractor.code,
    parentId: contractor.parentId,
    taxId: contractor.taxId,
    legalName: contractor.legalName,
    registrationNumber: contractor.registrationNumber,
    isActive: contractor.isActive,
    createdAt: contractor.createdAt.toISOString(),
    updatedAt: contractor.updatedAt.toISOString(),
  })
}

export async function DELETE(req: Request, ctx: { params?: Promise<{ id?: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = await ctx.params
  const parse = paramsSchema.safeParse({ id: params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid contractor id' }, { status: 400 })

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = container.resolve('em') as EntityManager

  const scopeFilters = buildScopeFilters(auth, scope)
  const filters: Record<string, unknown> = {
    id: parse.data.id,
    deletedAt: null,
    ...scopeFilters,
  }

  const contractor = await em.findOne(Contractor, filters)

  if (!contractor) return NextResponse.json({ error: 'Contractor not found' }, { status: 404 })

  contractor.deletedAt = new Date()
  await em.flush()

  return NextResponse.json({ success: true })
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['contractors.view'] },
  PUT: { requireAuth: true, requireFeatures: ['contractors.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['contractors.delete'] },
}
