import {
  leadCreateSchema,
  leadUpdateSchema,
  leadConvertSchema,
  leadConvertBodySchema,
} from '../data/validators'

const VALID_ORG_ID = '00000000-0000-1000-8000-000000000001'
const VALID_TENANT_ID = '00000000-0000-1000-8000-000000000002'
const VALID_LEAD_ID = '00000000-0000-1000-8000-000000000003'

describe('lead command validation contracts', () => {
  describe('leadCreateSchema — status defaults and restrictions', () => {
    it('defaults status to open when omitted', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'Test Lead',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBeUndefined()
      }
    })

    it('rejects status = qualified on create', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'Test Lead',
        status: 'qualified',
      })
      expect(result.success).toBe(false)
    })

    it('accepts status = in_progress on create', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'Test Lead',
        status: 'in_progress',
      })
      expect(result.success).toBe(true)
    })

    it('accepts status = rejected on create', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'Test Lead',
        status: 'rejected',
      })
      expect(result.success).toBe(true)
    })
  })

  describe('leadUpdateSchema — status update restrictions', () => {
    it('rejects status = qualified on update', () => {
      const result = leadUpdateSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        status: 'qualified',
      })
      expect(result.success).toBe(false)
    })

    it('accepts status = open on update', () => {
      const result = leadUpdateSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        status: 'open',
      })
      expect(result.success).toBe(true)
    })

    it('accepts status = in_progress on update', () => {
      const result = leadUpdateSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        status: 'in_progress',
      })
      expect(result.success).toBe(true)
    })

    it('accepts status = rejected on update', () => {
      const result = leadUpdateSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        status: 'rejected',
      })
      expect(result.success).toBe(true)
    })

    it('accepts partial update with only candidate fields (no status)', () => {
      const result = leadUpdateSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        companyName: 'Acme Corp',
        contactFirstName: 'Jane',
      })
      expect(result.success).toBe(true)
    })
  })

  describe('leadConvertSchema — conversion target validation', () => {
    it('accepts createDeal only', () => {
      const result = leadConvertSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        createDeal: true,
        createPerson: false,
        createCompany: false,
      })
      expect(result.success).toBe(true)
    })

    it('accepts createPerson only', () => {
      const result = leadConvertSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        createDeal: false,
        createPerson: true,
        createCompany: false,
      })
      expect(result.success).toBe(true)
    })

    it('accepts createCompany only', () => {
      const result = leadConvertSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        createDeal: false,
        createPerson: false,
        createCompany: true,
      })
      expect(result.success).toBe(true)
    })

    it('accepts person + company without deal', () => {
      const result = leadConvertSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        createDeal: false,
        createPerson: true,
        createCompany: true,
      })
      expect(result.success).toBe(true)
    })

    it('accepts deal + person without company', () => {
      const result = leadConvertSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        createDeal: true,
        createPerson: true,
        createCompany: false,
      })
      expect(result.success).toBe(true)
    })

    it('accepts deal + company without person', () => {
      const result = leadConvertSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        createDeal: true,
        createPerson: false,
        createCompany: true,
      })
      expect(result.success).toBe(true)
    })

    it('accepts all three selected', () => {
      const result = leadConvertSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        createDeal: true,
        createPerson: true,
        createCompany: true,
      })
      expect(result.success).toBe(true)
    })

    it('rejects when all three are false', () => {
      const result = leadConvertSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        createDeal: false,
        createPerson: false,
        createCompany: false,
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing id', () => {
      const result = leadConvertSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        createDeal: true,
        createPerson: false,
        createCompany: false,
      })
      expect(result.success).toBe(false)
    })

    it('accepts optional deal overrides', () => {
      const result = leadConvertSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        createDeal: true,
        createPerson: false,
        createCompany: false,
        deal: {
          title: 'Custom Deal Title',
          valueAmount: 15000,
          valueCurrency: 'USD',
        },
      })
      expect(result.success).toBe(true)
    })

    it('rejects negative deal value amount', () => {
      const result = leadConvertSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        createDeal: true,
        createPerson: false,
        createCompany: false,
        deal: {
          valueAmount: -100,
        },
      })
      expect(result.success).toBe(false)
    })

    it('rejects invalid deal currency (not 3 letters)', () => {
      const result = leadConvertSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        createDeal: true,
        createPerson: false,
        createCompany: false,
        deal: {
          valueCurrency: 'US',
        },
      })
      expect(result.success).toBe(false)
    })
  })

  describe('leadConvertBodySchema — body schema omits scope fields', () => {
    it('does not require id (provided by route from URL params)', () => {
      const result = leadConvertBodySchema.safeParse({
        createDeal: true,
        createPerson: false,
        createCompany: false,
      })
      expect(result.success).toBe(true)
    })

    it('does not require tenantId or organizationId', () => {
      const result = leadConvertBodySchema.safeParse({
        createDeal: false,
        createPerson: true,
        createCompany: false,
      })
      expect(result.success).toBe(true)
    })

    it('still rejects when all three are false', () => {
      const result = leadConvertBodySchema.safeParse({
        createDeal: false,
        createPerson: false,
        createCompany: false,
      })
      expect(result.success).toBe(false)
    })

    it('accepts all three with deal overrides', () => {
      const result = leadConvertBodySchema.safeParse({
        createDeal: true,
        createPerson: true,
        createCompany: true,
        deal: {
          title: 'Big Deal',
          pipelineId: '00000000-0000-1000-8000-000000000010',
          pipelineStageId: '00000000-0000-1000-8000-000000000011',
          valueAmount: 50000,
          valueCurrency: 'EUR',
        },
      })
      expect(result.success).toBe(true)
    })
  })

  describe('tenant and organization scoping on validators', () => {
    it('rejects create without organizationId', () => {
      const result = leadCreateSchema.safeParse({
        tenantId: VALID_TENANT_ID,
        title: 'Test Lead',
      })
      expect(result.success).toBe(false)
    })

    it('rejects create without tenantId', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        title: 'Test Lead',
      })
      expect(result.success).toBe(false)
    })

    it('rejects create with invalid organizationId', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: 'not-a-uuid',
        tenantId: VALID_TENANT_ID,
        title: 'Test Lead',
      })
      expect(result.success).toBe(false)
    })

    it('rejects update without id', () => {
      const result = leadUpdateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'Updated Title',
      })
      expect(result.success).toBe(false)
    })

    it('rejects convert without organizationId', () => {
      const result = leadConvertSchema.safeParse({
        id: VALID_LEAD_ID,
        tenantId: VALID_TENANT_ID,
        createDeal: true,
        createPerson: false,
        createCompany: false,
      })
      expect(result.success).toBe(false)
    })

    it('rejects convert without tenantId', () => {
      const result = leadConvertSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        createDeal: true,
        createPerson: false,
        createCompany: false,
      })
      expect(result.success).toBe(false)
    })
  })
})