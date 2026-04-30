import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUser, DomainMapping, type DomainStatus } from './entities'

type EntityRecord = Record<string, unknown> & { id: string }
type EnricherScope = EnricherContext & { em: EntityManager }

type PersonAccountEnrichment = {
  _customer_accounts: {
    hasAccount: boolean
    userId?: string
    isActive?: boolean
    lastLoginAt?: string | null
  }
}

type CompanyUserCountEnrichment = {
  _customer_accounts: {
    userCount: number
  }
}

const PERSON_FALLBACK = { _customer_accounts: { hasAccount: false } }
const COMPANY_FALLBACK = { _customer_accounts: { userCount: 0 } }

const personAccountStatusEnricher: ResponseEnricher<EntityRecord, PersonAccountEnrichment> = {
  id: 'customer_accounts.person-account-status',
  targetEntity: 'customers.person',
  features: ['customer_accounts.view'],
  priority: 10,
  timeout: 2000,
  critical: false,
  fallback: PERSON_FALLBACK,

  async enrichOne(record, context: EnricherScope) {
    return (await this.enrichMany!([record], context))[0]
  },

  async enrichMany(records, context: EnricherScope) {
    if (records.length === 0) return records as (EntityRecord & PersonAccountEnrichment)[]

    const em = context.em.fork()
    const recordIds = records.map((r) => r.id)

    const users = await em.find(CustomerUser, {
      personEntityId: { $in: recordIds },
      tenantId: context.tenantId,
      deletedAt: null,
    })

    const userByPersonId = new Map<string, CustomerUser>()
    for (const user of users) {
      if (user.personEntityId) {
        userByPersonId.set(user.personEntityId, user)
      }
    }

    return records.map((record) => {
      const user = userByPersonId.get(record.id)
      if (!user) {
        return { ...record, _customer_accounts: { hasAccount: false } }
      }
      return {
        ...record,
        _customer_accounts: {
          hasAccount: true,
          userId: user.id,
          isActive: user.isActive,
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        },
      }
    })
  },
}

const companyUserCountEnricher: ResponseEnricher<EntityRecord, CompanyUserCountEnrichment> = {
  id: 'customer_accounts.company-user-count',
  targetEntity: 'customers.company',
  features: ['customer_accounts.view'],
  priority: 10,
  timeout: 2000,
  critical: false,
  fallback: COMPANY_FALLBACK,

  async enrichOne(record, context: EnricherScope) {
    return (await this.enrichMany!([record], context))[0]
  },

  async enrichMany(records, context: EnricherScope) {
    if (records.length === 0) return records as (EntityRecord & CompanyUserCountEnrichment)[]

    const em = context.em.fork()
    const recordIds = records.map((r) => r.id)

    const users = await em.find(CustomerUser, {
      customerEntityId: { $in: recordIds },
      tenantId: context.tenantId,
      deletedAt: null,
    })

    const countByCompanyId = new Map<string, number>()
    for (const user of users) {
      if (user.customerEntityId) {
        countByCompanyId.set(user.customerEntityId, (countByCompanyId.get(user.customerEntityId) ?? 0) + 1)
      }
    }

    return records.map((record) => ({
      ...record,
      _customer_accounts: {
        userCount: countByCompanyId.get(record.id) ?? 0,
      },
    }))
  },
}

type OrgCustomDomainEnrichment = {
  _customDomain: { hostname: string; status: DomainStatus } | null
}

const ORG_DOMAIN_FALLBACK: OrgCustomDomainEnrichment = { _customDomain: null }

const ACTIVE_DOMAIN_PRIORITY: Record<DomainStatus, number> = {
  active: 0,
  verified: 1,
  pending: 2,
  tls_failed: 3,
  dns_failed: 4,
}

function pickPrimaryDomain(records: DomainMapping[]): DomainMapping | null {
  if (records.length === 0) return null
  return records
    .slice()
    .sort(
      (a, b) =>
        (ACTIVE_DOMAIN_PRIORITY[a.status] ?? 99) - (ACTIVE_DOMAIN_PRIORITY[b.status] ?? 99) ||
        (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0),
    )[0]
}

const organizationCustomDomainEnricher: ResponseEnricher<EntityRecord, OrgCustomDomainEnrichment> = {
  id: 'customer_accounts.domain-status:directory:organization',
  targetEntity: 'directory:organization',
  features: ['customer_accounts.domain.manage'],
  priority: 10,
  timeout: 1_000,
  critical: false,
  fallback: ORG_DOMAIN_FALLBACK,

  async enrichOne(record, context: EnricherScope) {
    return (await this.enrichMany!([record], context))[0]
  },

  async enrichMany(records, context: EnricherScope) {
    if (records.length === 0) return records as (EntityRecord & OrgCustomDomainEnrichment)[]

    const em = context.em.fork()
    const recordIds = records.map((r) => r.id)
    const domains = await em.find(DomainMapping, {
      organizationId: { $in: recordIds },
      tenantId: context.tenantId,
    } as never)

    const byOrg = new Map<string, DomainMapping[]>()
    for (const d of domains) {
      const list = byOrg.get(d.organizationId) ?? []
      list.push(d)
      byOrg.set(d.organizationId, list)
    }

    return records.map((record) => {
      const matches = byOrg.get(record.id) ?? []
      const primary = pickPrimaryDomain(matches)
      return {
        ...record,
        _customDomain: primary ? { hostname: primary.hostname, status: primary.status } : null,
      }
    })
  },
}

export const enrichers: ResponseEnricher[] = [
  personAccountStatusEnricher,
  companyUserCountEnricher,
  organizationCustomDomainEnricher,
]
