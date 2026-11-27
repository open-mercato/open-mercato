import { LockMode, type FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerCompanyBilling, CustomerEntity, CustomerPersonCompanyRole } from '../data/entities'

type RoleSnapshot = {
  id: string
  personId: string
  companyId: string
  roleValue: string
  createdAt: Date | string
}

type BillingSnapshot = Pick<CustomerCompanyBilling, 'id' | 'bankName' | 'bankAccountMasked' | 'paymentTerms' | 'preferredCurrency'> & {
  createdAt: Date | string
  updatedAt: Date | string
}

export type CustomerDeleteDependenciesSnapshot = {
  roles: RoleSnapshot[]
  billing?: BillingSnapshot
}

function roleFilter(entity: CustomerEntity): FilterQuery<CustomerPersonCompanyRole> {
  return {
    $or: [{ personEntity: entity }, { companyEntity: entity }],
    organizationId: entity.organizationId,
    tenantId: entity.tenantId,
  }
}

function roleSnapshot(row: CustomerPersonCompanyRole): RoleSnapshot {
  return {
    id: row.id,
    personId: row.personEntity.id,
    companyId: row.companyEntity.id,
    roleValue: row.roleValue,
    createdAt: row.createdAt,
  }
}

export async function removeCustomerDeleteDependencies(
  em: EntityManager,
  entity: CustomerEntity,
): Promise<CustomerDeleteDependenciesSnapshot | undefined> {
  const scope = { organizationId: entity.organizationId, tenantId: entity.tenantId }
  const lock = { lockMode: LockMode.PESSIMISTIC_WRITE } as const
  const roles = (await findWithDecryption(em, CustomerPersonCompanyRole, roleFilter(entity), lock, scope))
    .map(roleSnapshot)
  const billing = await findOneWithDecryption(em, CustomerCompanyBilling, { entity, ...scope }, lock, scope)
  if (!roles.length && !billing) return undefined
  if (roles.length) {
    await em.nativeDelete(CustomerPersonCompanyRole, { id: { $in: roles.map((row) => row.id) }, ...scope })
  }
  if (!billing) return { roles }

  await em.nativeDelete(CustomerCompanyBilling, { id: billing.id, ...scope })
  return {
    roles,
    billing: {
      id: billing.id,
      bankName: billing.bankName,
      bankAccountMasked: billing.bankAccountMasked,
      paymentTerms: billing.paymentTerms,
      preferredCurrency: billing.preferredCurrency,
      createdAt: billing.createdAt,
      updatedAt: billing.updatedAt,
    },
  }
}

function roleKey(row: RoleSnapshot) {
  return JSON.stringify([row.personId, row.companyId, row.roleValue])
}

export async function restoreCustomerDeleteDependencies(
  em: EntityManager,
  entity: CustomerEntity,
  snapshot: CustomerDeleteDependenciesSnapshot | undefined,
): Promise<void> {
  if (!snapshot) return
  const scope = { organizationId: entity.organizationId, tenantId: entity.tenantId }
  const { roles, billing } = snapshot
  if (roles.length) {
    const relatedIds = [...new Set(roles.flatMap((row) => [row.personId, row.companyId]))]
      .filter((id) => id !== entity.id)
    const related = await findWithDecryption(
      em, CustomerEntity, { id: { $in: relatedIds }, deletedAt: null, ...scope }, undefined, scope,
    )
    const byId = new Map(related.map((row) => [row.id, row]))
    byId.set(entity.id, entity)
    const existing = await findWithDecryption(em, CustomerPersonCompanyRole, roleFilter(entity), undefined, scope)
    const existingKeys = new Set(existing.map((row) => roleKey(roleSnapshot(row))))
    for (const row of roles) {
      const personEntity = byId.get(row.personId)
      const companyEntity = byId.get(row.companyId)
      const key = roleKey(row)
      if (!personEntity || !companyEntity || existingKeys.has(key)) continue
      em.persist(em.create(CustomerPersonCompanyRole, {
        id: row.id,
        ...scope,
        personEntity,
        companyEntity,
        roleValue: row.roleValue,
        createdAt: new Date(row.createdAt),
      }))
      existingKeys.add(key)
    }
  }
  if (billing && !await findOneWithDecryption(em, CustomerCompanyBilling, { entity, ...scope }, undefined, scope)) {
    em.persist(em.create(CustomerCompanyBilling, {
      ...billing,
      ...scope,
      entity,
      createdAt: new Date(billing.createdAt),
      updatedAt: new Date(billing.updatedAt),
    }))
  }
}
