import { createShipmentSchema, calculateRatesSchema } from '../validators'

const UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const validAddress = {
  countryCode: 'PL',
  postalCode: '00-001',
  city: 'Warsaw',
  line1: 'ul. Testowa 1',
}

const validPackage = { weightKg: 1, lengthCm: 20, widthCm: 15, heightCm: 10 }

const createBase = {
  providerKey: 'inpost',
  orderId: UUID,
  origin: validAddress,
  destination: validAddress,
  packages: [validPackage],
  serviceCode: 'standard',
}

const ratesBase = {
  providerKey: 'inpost',
  origin: validAddress,
  destination: validAddress,
  packages: [validPackage],
}

// ---------------------------------------------------------------------------
// createShipmentSchema — email validation
// ---------------------------------------------------------------------------

describe('createShipmentSchema — email validation', () => {
  it('accepts a valid senderEmail', () => {
    const result = createShipmentSchema.safeParse({
      ...createBase,
      senderEmail: 'sender@example.com',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid receiverEmail', () => {
    const result = createShipmentSchema.safeParse({
      ...createBase,
      receiverEmail: 'receiver@example.com',
    })
    expect(result.success).toBe(true)
  })

  it('accepts when email fields are omitted', () => {
    const result = createShipmentSchema.safeParse(createBase)
    expect(result.success).toBe(true)
  })

  it('rejects an invalid senderEmail', () => {
    const result = createShipmentSchema.safeParse({
      ...createBase,
      senderEmail: 'abc',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths).toContain('senderEmail')
    }
  })

  it('rejects an invalid receiverEmail', () => {
    const result = createShipmentSchema.safeParse({
      ...createBase,
      receiverEmail: 'not-an-email',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths).toContain('receiverEmail')
    }
  })

  it('rejects email without domain', () => {
    const result = createShipmentSchema.safeParse({
      ...createBase,
      senderEmail: 'user@',
    })
    expect(result.success).toBe(false)
  })

  it('trims whitespace from email before validation', () => {
    const result = createShipmentSchema.safeParse({
      ...createBase,
      senderEmail: '  valid@example.com  ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.senderEmail).toBe('valid@example.com')
    }
  })
})

// ---------------------------------------------------------------------------
// createShipmentSchema — phone validation
// ---------------------------------------------------------------------------

describe('createShipmentSchema — phone validation', () => {
  it('accepts a valid senderPhone with country code', () => {
    const result = createShipmentSchema.safeParse({
      ...createBase,
      senderPhone: '+48 500 000 000',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid receiverPhone with digits only', () => {
    const result = createShipmentSchema.safeParse({
      ...createBase,
      receiverPhone: '500000000',
    })
    expect(result.success).toBe(true)
  })

  it('accepts phone with dashes and parentheses', () => {
    const result = createShipmentSchema.safeParse({
      ...createBase,
      senderPhone: '+1 (555) 123-4567',
    })
    expect(result.success).toBe(true)
  })

  it('accepts when phone fields are omitted', () => {
    const result = createShipmentSchema.safeParse(createBase)
    expect(result.success).toBe(true)
  })

  it('rejects alphabetic-only phone value', () => {
    const result = createShipmentSchema.safeParse({
      ...createBase,
      senderPhone: 'xyz',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths).toContain('senderPhone')
    }
  })

  it('rejects phone that is too short', () => {
    const result = createShipmentSchema.safeParse({
      ...createBase,
      receiverPhone: '123',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths).toContain('receiverPhone')
    }
  })

  it('rejects phone starting with a letter', () => {
    const result = createShipmentSchema.safeParse({
      ...createBase,
      senderPhone: 'a1234567',
    })
    expect(result.success).toBe(false)
  })

  it('trims whitespace from phone before validation', () => {
    const result = createShipmentSchema.safeParse({
      ...createBase,
      senderPhone: '  +48 500 000 000  ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.senderPhone).toBe('+48 500 000 000')
    }
  })
})

// ---------------------------------------------------------------------------
// calculateRatesSchema — email & phone validation
// ---------------------------------------------------------------------------

describe('calculateRatesSchema — email validation', () => {
  it('accepts a valid receiverEmail', () => {
    const result = calculateRatesSchema.safeParse({
      ...ratesBase,
      receiverEmail: 'test@example.com',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid receiverEmail', () => {
    const result = calculateRatesSchema.safeParse({
      ...ratesBase,
      receiverEmail: 'bad-email',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths).toContain('receiverEmail')
    }
  })
})

describe('calculateRatesSchema — phone validation', () => {
  it('accepts a valid receiverPhone', () => {
    const result = calculateRatesSchema.safeParse({
      ...ratesBase,
      receiverPhone: '+48 500 000 000',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid receiverPhone', () => {
    const result = calculateRatesSchema.safeParse({
      ...ratesBase,
      receiverPhone: 'xyz',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths).toContain('receiverPhone')
    }
  })
})
