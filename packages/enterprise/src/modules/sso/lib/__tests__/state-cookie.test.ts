import { encryptStateCookie, decryptStateCookie, createFlowState } from '../state-cookie'
import type { SsoFlowState } from '../types'

describe('state-cookie', () => {
  const originalEnv = process.env

  beforeAll(() => {
    process.env = { ...originalEnv }
    process.env.SSO_STATE_SECRET = 'test-secret-key-at-least-32-chars-long'
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('encryptStateCookie / decryptStateCookie round-trip', () => {
    const flowState: SsoFlowState = {
      state: 'test-state',
      nonce: 'test-nonce',
      codeVerifier: 'test-code-verifier',
      configId: 'config-123',
      returnUrl: '/dashboard',
      expiresAt: Date.now() + 5 * 60 * 1000,
    }

    test('successfully encrypts and decrypts a flow state', () => {
      const encrypted = encryptStateCookie(flowState)
      const decrypted = decryptStateCookie(encrypted)

      expect(decrypted).toEqual(flowState)
    })

    test('returns null for empty cookie string', () => {
      expect(decryptStateCookie('')).toBeNull()
    })

    test('returns null for invalid cookie string', () => {
      expect(decryptStateCookie('not-valid-base64url!!!')).toBeNull()
    })

    test('returns null for too-short buffer', () => {
      const shortBuffer = Buffer.alloc(10).toString('base64url')
      expect(decryptStateCookie(shortBuffer)).toBeNull()
    })

    test('returns null for tampered ciphertext', () => {
      const encrypted = encryptStateCookie(flowState)
      const buffer = Buffer.from(encrypted, 'base64url')
      buffer[buffer.length - 1] ^= 0xff
      const tampered = buffer.toString('base64url')

      expect(decryptStateCookie(tampered)).toBeNull()
    })

    test('returns null for expired cookie', () => {
      const expiredState: SsoFlowState = {
        ...flowState,
        expiresAt: Date.now() - 1000,
      }
      const encrypted = encryptStateCookie(expiredState)
      expect(decryptStateCookie(encrypted)).toBeNull()
    })

    test('throws when no secret env vars are set', () => {
      const saved = process.env.SSO_STATE_SECRET
      delete process.env.SSO_STATE_SECRET
      delete process.env.JWT_SECRET

      expect(() => encryptStateCookie(flowState)).toThrow('SSO_STATE_SECRET or JWT_SECRET must be set')

      process.env.SSO_STATE_SECRET = saved
    })
  })

  describe('createFlowState', () => {
    test('returns state with all required fields', () => {
      const { state, codeVerifier } = createFlowState({
        configId: 'config-1',
        returnUrl: '/home',
      })

      expect(state).toHaveProperty('state')
      expect(state).toHaveProperty('nonce')
      expect(state).toHaveProperty('codeVerifier')
      expect(state).toHaveProperty('configId', 'config-1')
      expect(state).toHaveProperty('returnUrl', '/home')
      expect(state).toHaveProperty('expiresAt')
      expect(typeof codeVerifier).toBe('string')
      expect(codeVerifier.length).toBeGreaterThan(0)
    })

    test('returns unique codeVerifier', () => {
      const result1 = createFlowState({ configId: 'c1', returnUrl: '/' })
      const result2 = createFlowState({ configId: 'c1', returnUrl: '/' })

      expect(result1.codeVerifier).not.toBe(result2.codeVerifier)
    })

    test('returns expiresAt approximately 5 minutes in the future', () => {
      const before = Date.now()
      const { state } = createFlowState({ configId: 'c1', returnUrl: '/' })
      const after = Date.now()

      const fiveMinutesMs = 5 * 60 * 1000
      expect(state.expiresAt).toBeGreaterThanOrEqual(before + fiveMinutesMs)
      expect(state.expiresAt).toBeLessThanOrEqual(after + fiveMinutesMs)
    })

    test('returns unique state values on each call', () => {
      const result1 = createFlowState({ configId: 'c1', returnUrl: '/' })
      const result2 = createFlowState({ configId: 'c1', returnUrl: '/' })

      expect(result1.state.state).not.toBe(result2.state.state)
      expect(result1.state.nonce).not.toBe(result2.state.nonce)
    })
  })
})
