import {
  leadCreateSchema,
  leadUpdateSchema,
  leadConvertSchema,
} from '../data/validators'

const VALID_ORG_ID = '00000000-0000-1000-8000-000000000001'
const VALID_TENANT_ID = '00000000-0000-1000-8000-000000000002'
const VALID_LEAD_ID = '00000000-0000-1000-8000-000000000003'

describe('lead validators', () => {
  describe('leadCreateSchema', () => {
    it('accepts a minimal valid lead with only required fields', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'Test Lead',
      })
      expect(result.success).toBe(true)
    })

    it('accepts a full valid lead with all candidate fields', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'Enterprise Lead',
        description: 'A promising lead',
        source: 'website',
        estimatedValueAmount: 5000,
        estimatedValueCurrency: 'EUR',
        companyName: 'Acme Inc',
        companyVatId: 'EU123456789',
        contactFirstName: 'Jane',
        contactLastName: 'Doe',
        contactPhone: '+48 600 100 200',
        contactEmail: 'jane@acme.com',
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing title', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
      })
      expect(result.success).toBe(false)
    })

    it('rejects empty title', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: '',
      })
      expect(result.success).toBe(false)
    })

    it('rejects title longer than 200 characters', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'x'.repeat(201),
      })
      expect(result.success).toBe(false)
    })

    it('rejects status = qualified', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'Test Lead',
        status: 'qualified',
      })
      expect(result.success).toBe(false)
    })

    it('accepts status = open', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'Test Lead',
        status: 'open',
      })
      expect(result.success).toBe(true)
    })

    it('accepts status = in_progress', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'Test Lead',
        status: 'in_progress',
      })
      expect(result.success).toBe(true)
    })

    it('accepts status = rejected', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'Test Lead',
        status: 'rejected',
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid email', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'Test Lead',
        contactEmail: 'not-an-email',
      })
      expect(result.success).toBe(false)
    })

    it('rejects currency that is not 3 letters', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'Test Lead',
        estimatedValueCurrency: 'EURO',
      })
      expect(result.success).toBe(false)
    })

    it('rejects negative estimated value', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'Test Lead',
        estimatedValueAmount: -100,
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing organizationId', () => {
      const result = leadCreateSchema.safeParse({
        tenantId: VALID_TENANT_ID,
        title: 'Test Lead',
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing tenantId', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        title: 'Test Lead',
      })
      expect(result.success).toBe(false)
    })

    it('rejects invalid organizationId', () => {
      const result = leadCreateSchema.safeParse({
        organizationId: 'not-a-uuid',
        tenantId: VALID_TENANT_ID,
        title: 'Test Lead',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('leadUpdateSchema', () => {
    it('accepts updating title only with id and scope', () => {
      const result = leadUpdateSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'Updated Title',
      })
      expect(result.success).toBe(true)
    })

    it('rejects status = qualified', () => {
      const result = leadUpdateSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        status: 'qualified',
      })
      expect(result.success).toBe(false)
    })

    it('accepts status = open', () => {
      const result = leadUpdateSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        status: 'open',
      })
      expect(result.success).toBe(true)
    })

    it('accepts status = in_progress', () => {
      const result = leadUpdateSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        status: 'in_progress',
      })
      expect(result.success).toBe(true)
    })

    it('accepts status = rejected', () => {
      const result = leadUpdateSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        status: 'rejected',
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing id', () => {
      const result = leadUpdateSchema.safeParse({
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        title: 'Updated Title',
      })
      expect(result.success).toBe(false)
    })

    it('accepts partial update with only candidate fields', () => {
      const result = leadUpdateSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        companyName: 'New Company Name',
        contactFirstName: 'NewFirst',
        contactLastName: 'NewLast',
      })
      expect(result.success).toBe(true)
    })
  })

  describe('leadConvertSchema', () => {
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
          valueAmount: 10000,
          valueCurrency: 'USD',
        },
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid deal currency', () => {
      const result = leadConvertSchema.safeParse({
        id: VALID_LEAD_ID,
        organizationId: VALID_ORG_ID,
        tenantId: VALID_TENANT_ID,
        createDeal: true,
        createPerson: false,
        createCompany: false,
        deal: {
          valueCurrency: 'TOOLONG',
        },
      })
      expect(result.success).toBe(false)
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
          valueAmount: -500,
        },
      })
      expect(result.success).toBe(false)
    })
  })
})