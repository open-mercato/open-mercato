import { encodeWebhookToken, decodeWebhookToken } from '../webhookToken'

describe('webhookToken', () => {
  const testData = {
    organizationId: 'org-123',
    tenantId: 'tenant-456',
  }

  describe('encodeWebhookToken', () => {
    it('should encode organizationId and tenantId into a token', () => {
      const token = encodeWebhookToken(testData)

      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      expect(token).toContain('.')
    })

    it('should create a token with two parts separated by a dot', () => {
      const token = encodeWebhookToken(testData)
      const parts = token.split('.')

      expect(parts).toHaveLength(2)
      expect(parts[0]).toBeTruthy() // payload
      expect(parts[1]).toBeTruthy() // signature
    })

    it('should create different tokens for different inputs', () => {
      const token1 = encodeWebhookToken({
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      })

      const token2 = encodeWebhookToken({
        organizationId: 'org-2',
        tenantId: 'tenant-2',
      })

      expect(token1).not.toBe(token2)
    })
  })

  describe('decodeWebhookToken', () => {
    it('should decode a valid token', () => {
      const token = encodeWebhookToken(testData)
      const decoded = decodeWebhookToken(token)

      expect(decoded).toEqual(testData)
    })

    it('should return null for invalid token format', () => {
      const decoded = decodeWebhookToken('invalid-token')

      expect(decoded).toBeNull()
    })

    it('should return null for tampered token', () => {
      const token = encodeWebhookToken(testData)
      const tampered = token.slice(0, -5) + 'xxxxx'
      const decoded = decodeWebhookToken(tampered)

      expect(decoded).toBeNull()
    })

    it('should return null for token with invalid signature', () => {
      const token = encodeWebhookToken(testData)
      const [payload] = token.split('.')
      const tamperedToken = `${payload}.invalid-signature`
      const decoded = decodeWebhookToken(tamperedToken)

      expect(decoded).toBeNull()
    })

    it('should return null for empty token', () => {
      const decoded = decodeWebhookToken('')

      expect(decoded).toBeNull()
    })

    it('should return null for token missing payload', () => {
      const decoded = decodeWebhookToken('.signature')

      expect(decoded).toBeNull()
    })

    it('should return null for token missing signature', () => {
      const token = encodeWebhookToken(testData)
      const [payload] = token.split('.')
      const decoded = decodeWebhookToken(`${payload}.`)

      expect(decoded).toBeNull()
    })
  })

  describe('token expiration', () => {
    it('should reject expired tokens', () => {
      // Create a token with a very old timestamp
      const oldTimestamp = Math.floor(Date.now() / 1000) - (366 * 24 * 60 * 60) // Over 1 year ago

      // We need to manually create an old token for testing
      // In a real scenario, you'd wait a year or mock Date.now()
      const payload = JSON.stringify({
        organizationId: testData.organizationId,
        tenantId: testData.tenantId,
        iat: oldTimestamp,
      })

      const crypto = require('crypto')
      const encodedPayload = Buffer.from(payload)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '')

      const signature = crypto
        .createHmac('sha256', 'test-secret-for-unit-tests')
        .update(encodedPayload)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '')

      const oldToken = `${encodedPayload}.${signature}`
      const decoded = decodeWebhookToken(oldToken)

      expect(decoded).toBeNull()
    })

    it('should accept fresh tokens', () => {
      const token = encodeWebhookToken(testData)
      const decoded = decodeWebhookToken(token)

      expect(decoded).toEqual(testData)
    })
  })

  describe('URL safety', () => {
    it('should create URL-safe tokens without special characters', () => {
      const token = encodeWebhookToken(testData)

      // Base64URL should not contain +, /, or =
      expect(token).not.toContain('+')
      expect(token).not.toContain('/')
      expect(token).not.toContain('=')
    })

    it('should work in query strings', () => {
      const token = encodeWebhookToken(testData)
      const url = `https://example.com/webhook?token=${token}`

      expect(url).toContain(token)
      
      // Extract token from URL
      const parsedUrl = new URL(url)
      const extractedToken = parsedUrl.searchParams.get('token')
      
      expect(extractedToken).toBe(token)
      
      // Decode extracted token
      const decoded = decodeWebhookToken(extractedToken!)
      expect(decoded).toEqual(testData)
    })
  })

  describe('round-trip encoding/decoding', () => {
    it('should successfully encode and decode multiple times', () => {
      const token1 = encodeWebhookToken(testData)
      const decoded1 = decodeWebhookToken(token1)
      
      expect(decoded1).toEqual(testData)
      
      // Encode again
      const token2 = encodeWebhookToken(testData)
      const decoded2 = decodeWebhookToken(token2)
      
      expect(decoded2).toEqual(testData)
    })

    it('should handle special characters in IDs', () => {
      const specialData = {
        organizationId: 'org-with-special-chars-123',
        tenantId: 'tenant_with_underscores-456',
      }

      const token = encodeWebhookToken(specialData)
      const decoded = decodeWebhookToken(token)

      expect(decoded).toEqual(specialData)
    })

    it('should handle UUID format IDs', () => {
      const uuidData = {
        organizationId: '550e8400-e29b-41d4-a716-446655440000',
        tenantId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      }

      const token = encodeWebhookToken(uuidData)
      const decoded = decodeWebhookToken(token)

      expect(decoded).toEqual(uuidData)
    })
  })
})
