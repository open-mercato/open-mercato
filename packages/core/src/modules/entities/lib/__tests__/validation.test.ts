/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/core'
import { validateCustomFieldValuesServer } from '../validation'

type ValidationRule =
  | { rule: 'required'; message: string }
  | { rule: 'integer'; message: string }
  | { rule: 'lte'; param: number; message: string }

type CustomFieldDefStub = {
  key: string
  kind: string
  organizationId: string | null
  tenantId: string | null
  updatedAt: Date
  configJson: {
    validation: ValidationRule[]
  }
}

function createDefinition(input: {
  organizationId: string | null
  tenantId: string | null
  updatedAt?: string
  validation: ValidationRule[]
}): CustomFieldDefStub {
  return {
    key: 'priority',
    kind: 'integer',
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    updatedAt: new Date(input.updatedAt ?? '2026-03-31T00:00:00.000Z'),
    configJson: {
      validation: input.validation,
    },
  }
}

describe('validateCustomFieldValuesServer', () => {
  it('matches tenant-scoped definitions with global organization scope', async () => {
    const definition = createDefinition({
      organizationId: null,
      tenantId: 'tenant-1',
      validation: [{ rule: 'lte', param: 5, message: 'priority <= 5' }],
    })
    const em = {
      find: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
        const clauses = Array.isArray(where.$and) ? where.$and as Array<Record<string, unknown>> : []
        const orgClause = clauses.find((entry) => Array.isArray(entry.$or))
        const tenantClause = clauses.find((entry) =>
          Array.isArray(entry.$or) &&
          (entry.$or as Array<Record<string, unknown>>).some((candidate) => Object.prototype.hasOwnProperty.call(candidate, 'tenantId')),
        )
        const orgOptions = Array.isArray(orgClause?.$or) ? orgClause.$or as Array<Record<string, unknown>> : []
        const tenantOptions = Array.isArray(tenantClause?.$or) ? tenantClause.$or as Array<Record<string, unknown>> : []
        const hasOrgMatch = orgOptions.some((candidate) => candidate.organizationId === 'org-1')
          && orgOptions.some((candidate) => candidate.organizationId === null)
        const hasTenantMatch = tenantOptions.some((candidate) => candidate.tenantId === 'tenant-1')
          && tenantOptions.some((candidate) => candidate.tenantId === null)
        return hasOrgMatch && hasTenantMatch ? [definition] : []
      }),
    } as unknown as EntityManager

    const result = await validateCustomFieldValuesServer(em, {
      entityId: 'example:todo',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      values: { priority: 8 },
    })

    expect(result.ok).toBe(false)
    expect(result.fieldErrors.cf_priority).toBe('priority <= 5')
  })

  it('prefers the most specific matching definition for duplicate keys', async () => {
    const globalDefinition = createDefinition({
      organizationId: null,
      tenantId: null,
      updatedAt: '2026-03-30T00:00:00.000Z',
      validation: [{ rule: 'lte', param: 5, message: 'global <= 5' }],
    })
    const tenantDefinition = createDefinition({
      organizationId: null,
      tenantId: 'tenant-1',
      updatedAt: '2026-03-31T00:00:00.000Z',
      validation: [{ rule: 'lte', param: 4, message: 'tenant <= 4' }],
    })
    const orgDefinition = createDefinition({
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      updatedAt: '2026-03-29T00:00:00.000Z',
      validation: [{ rule: 'lte', param: 3, message: 'org <= 3' }],
    })
    const em = {
      find: jest.fn(async () => [globalDefinition, tenantDefinition, orgDefinition]),
    } as unknown as EntityManager

    const result = await validateCustomFieldValuesServer(em, {
      entityId: 'example:todo',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      values: { priority: 4 },
    })

    expect(result.ok).toBe(false)
    expect(result.fieldErrors.cf_priority).toBe('org <= 3')
  })
})
