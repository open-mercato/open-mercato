import {
  RETURN_DATE_IN_FUTURE_MESSAGE,
  returnCreateSchema,
  returnUpdateSchema,
} from '../validators'

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORDER_ID = '33333333-3333-4333-8333-333333333333'
const ORDER_LINE_ID = '44444444-4444-4444-8444-444444444444'
const RETURN_ID = '55555555-5555-4555-8555-555555555555'

const futureDate = () => {
  const date = new Date()
  date.setFullYear(date.getFullYear() + 1)
  return date.toISOString()
}

const createInput = (returnedAt?: string) => ({
  organizationId: ORGANIZATION_ID,
  tenantId: TENANT_ID,
  orderId: ORDER_ID,
  lines: [{ orderLineId: ORDER_LINE_ID, quantity: 1 }],
  ...(returnedAt ? { returnedAt } : {}),
})

const updateInput = (returnedAt?: string) => ({
  organizationId: ORGANIZATION_ID,
  tenantId: TENANT_ID,
  id: RETURN_ID,
  orderId: ORDER_ID,
  ...(returnedAt ? { returnedAt } : {}),
})

const expectFutureRejection = (result: ReturnType<typeof returnCreateSchema.safeParse>) => {
  expect(result.success).toBe(false)
  if (result.success) return
  const issue = result.error.issues.find((entry) => entry.path.includes('returnedAt'))
  expect(issue?.message).toBe(RETURN_DATE_IN_FUTURE_MESSAGE)
}

describe('return date validation — issue #3100', () => {
  describe('returnCreateSchema', () => {
    it('rejects a returnedAt in the future', () => {
      expectFutureRejection(returnCreateSchema.safeParse(createInput(futureDate())))
    })

    it('accepts a returnedAt in the past', () => {
      expect(returnCreateSchema.safeParse(createInput('2020-01-01')).success).toBe(true)
    })

    it('accepts an omitted returnedAt', () => {
      expect(returnCreateSchema.safeParse(createInput()).success).toBe(true)
    })

    it('accepts the current moment', () => {
      expect(returnCreateSchema.safeParse(createInput(new Date().toISOString())).success).toBe(true)
    })
  })

  describe('returnUpdateSchema', () => {
    it('rejects a returnedAt in the future', () => {
      expectFutureRejection(returnUpdateSchema.safeParse(updateInput(futureDate())))
    })

    it('accepts a returnedAt in the past', () => {
      expect(returnUpdateSchema.safeParse(updateInput('2020-01-01')).success).toBe(true)
    })

    it('accepts an omitted returnedAt', () => {
      expect(returnUpdateSchema.safeParse(updateInput()).success).toBe(true)
    })
  })
})
