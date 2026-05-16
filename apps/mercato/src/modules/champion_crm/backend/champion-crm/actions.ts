'use server'

import type { EntityManager } from '@mikro-orm/postgresql'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  advanceDealStage,
  assignApartmentToDeal,
  createDealFromLead,
  isChampionDealStage,
  markDealWon,
  qualifyLead,
  seedChampionCrmDemoData,
} from '../../lib/demo-flow'

async function resolveActionContext(requiredFeature: string) {
  const container = await createRequestContainer()
  const auth = await getAuthFromCookies()
  if (!auth?.tenantId) throw new Error('Unauthorized')
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: undefined })
  const organizationId = scope?.selectedId ?? auth.orgId
  if (!organizationId) throw new Error('Organization context is required')
  const rbacService = container.resolve('rbacService') as {
    userHasAllFeatures: (userId: string | undefined, features: string[], scope: { tenantId: string; organizationId: string }) => Promise<boolean>
  }
  const allowed = await rbacService.userHasAllFeatures(auth.sub, [requiredFeature], { tenantId: auth.tenantId, organizationId })
  if (!allowed) throw new Error('Insufficient permissions')
  const actorUserId = typeof auth.userId === 'string' && /^[0-9a-fA-F-]{36}$/.test(auth.userId) ? auth.userId : null
  return {
    em: container.resolve('em') as EntityManager,
    tenantId: auth.tenantId,
    organizationId,
    actorUserId,
  }
}

export async function qualifyLeadAction(formData: FormData) {
  const leadId = String(formData.get('leadId') ?? '')
  const ctx = await resolveActionContext('champion_crm.leads.manage')
  await qualifyLead(ctx.em, leadId, ctx)
  revalidatePath(`/backend/champion-crm/leads/${leadId}`)
}

export async function createDealFromLeadAction(formData: FormData) {
  const leadId = String(formData.get('leadId') ?? '')
  const ctx = await resolveActionContext('champion_crm.deals.manage')
  const deal = await createDealFromLead(ctx.em, leadId, ctx)
  revalidatePath(`/backend/champion-crm/leads/${leadId}`)
  redirect(`/backend/champion-crm/deals/${deal.id}`)
}

export async function assignApartmentAction(formData: FormData) {
  const dealId = String(formData.get('dealId') ?? '')
  const apartmentId = String(formData.get('apartmentId') ?? '')
  const ctx = await resolveActionContext('champion_crm.deals.manage')
  await assignApartmentToDeal(ctx.em, dealId, apartmentId, ctx)
  revalidatePath(`/backend/champion-crm/deals/${dealId}`)
}

export async function advanceDealStageAction(formData: FormData) {
  const dealId = String(formData.get('dealId') ?? '')
  const stage = String(formData.get('stage') ?? '')
  if (!isChampionDealStage(stage)) throw new Error('Unsupported deal stage')
  const ctx = await resolveActionContext('champion_crm.deals.manage')
  await advanceDealStage(ctx.em, dealId, stage, ctx)
  revalidatePath(`/backend/champion-crm/deals/${dealId}`)
}

export async function markDealWonAction(formData: FormData) {
  const dealId = String(formData.get('dealId') ?? '')
  const ctx = await resolveActionContext('champion_crm.deals.manage')
  await markDealWon(ctx.em, dealId, ctx)
  revalidatePath(`/backend/champion-crm/deals/${dealId}`)
}

export async function seedDemoAction() {
  const ctx = await resolveActionContext('champion_crm.admin')
  const seeded = await seedChampionCrmDemoData(ctx.em, ctx)
  revalidatePath('/backend/champion-crm/leads')
  redirect(`/backend/champion-crm/leads/${seeded.lead.id}`)
}
