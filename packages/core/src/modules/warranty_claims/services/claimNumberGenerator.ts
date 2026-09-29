import type { EntityManager } from '@mikro-orm/postgresql'
import { CLAIM_NUMBER_PREFIXES } from '../data/constants'
import type { WarrantyClaimType } from '../data/validators'
import { WarrantyClaimSequence } from '../data/entities'

type Scope = {
  organizationId: string
  tenantId: string
}

type GenerateParams = Scope & {
  claimType: WarrantyClaimType
}

const MAX_SEQUENCE = 1_000_000_000
const DEFAULT_SEQUENCE_START = 1

export class WarrantyClaimNumberGenerator {
  constructor(private readonly em: EntityManager) {}

  async peekNextSequence(claimType: WarrantyClaimType, scope: Scope): Promise<number> {
    const record = await this.em.findOne(WarrantyClaimSequence, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      claimType,
    })
    const nextNumber = typeof record?.nextNumber === 'number' ? record.nextNumber : DEFAULT_SEQUENCE_START
    return Math.min(Math.max(nextNumber, DEFAULT_SEQUENCE_START), MAX_SEQUENCE)
  }

  async setNextSequence(claimType: WarrantyClaimType, scope: Scope, nextValue: number): Promise<void> {
    const next = Math.min(Math.max(Math.floor(nextValue), DEFAULT_SEQUENCE_START), MAX_SEQUENCE)
    await this.em.getConnection().execute(
      `
        insert into warranty_claim_sequences (id, organization_id, tenant_id, claim_type, next_number, created_at, updated_at)
        values (gen_random_uuid(), ?, ?, ?, ?, now(), now())
        on conflict (tenant_id, organization_id, claim_type)
        do update set next_number = ?, updated_at = now()
      `,
      [scope.organizationId, scope.tenantId, claimType, next, next]
    )
  }

  async generate(params: GenerateParams): Promise<{ number: string; prefix: string; sequence: number }> {
    const sequence = await this.claimSequence(params.claimType, params)
    const prefix = CLAIM_NUMBER_PREFIXES[params.claimType]
    return {
      number: `${prefix}-${String(sequence).padStart(6, '0')}`,
      prefix,
      sequence,
    }
  }

  private async claimSequence(claimType: WarrantyClaimType, scope: Scope): Promise<number> {
    const rows = await this.em.getConnection().execute<{ sequence: string }[]>(
      `
        insert into warranty_claim_sequences (id, organization_id, tenant_id, claim_type, next_number, created_at, updated_at)
        values (gen_random_uuid(), ?, ?, ?, ?, now(), now())
        on conflict (tenant_id, organization_id, claim_type)
        do update set next_number = warranty_claim_sequences.next_number + 1, updated_at = now()
        returning next_number - 1 as sequence
      `,
      [scope.organizationId, scope.tenantId, claimType, DEFAULT_SEQUENCE_START + 1]
    )
    const value = Number(rows?.[0]?.sequence ?? DEFAULT_SEQUENCE_START)
    if (!Number.isFinite(value) || value < DEFAULT_SEQUENCE_START) return DEFAULT_SEQUENCE_START
    return Math.min(value, MAX_SEQUENCE)
  }
}
