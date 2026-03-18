import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { GatewayPaymentLink } from '../data/entities'

const ACCESS_TOKEN_VERSION = 'v1'
const ACCESS_TOKEN_TTL_MS = 1000 * 60 * 60 * 8

function resolveSecret(): string {
  const secret = process.env.APP_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('APP_SECRET or NEXTAUTH_SECRET must be configured for payment link signing')
  return secret
}

export function createPaymentLinkToken(): string {
  return crypto.randomBytes(18).toString('base64url')
}

export function normalizeCustomPaymentLinkToken(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

const RESERVED_TOKENS = new Set([
  'api', 'app', 'admin', 'backend', 'auth', 'login', 'logout', 'signup',
  'pay', 'static', 'public', 'assets', 'health', 'status', 'webhook',
  'webhooks', 'callback', 'oauth', 'portal', 'docs', 'help',
])

export function isValidCustomPaymentLinkToken(token: string): boolean {
  if (!(/^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?$/.test(token))) return false
  if (RESERVED_TOKENS.has(token)) return false
  return true
}

export async function hashPaymentLinkPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPaymentLinkPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false
  return bcrypt.compare(password, hash)
}

export function createPaymentLinkAccessToken(link: GatewayPaymentLink): string {
  const expiresAt = Date.now() + ACCESS_TOKEN_TTL_MS
  const payload = `${ACCESS_TOKEN_VERSION}.${link.id}.${link.token}.${expiresAt}`
  const signature = crypto.createHmac('sha256', resolveSecret()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function verifyPaymentLinkAccessToken(link: GatewayPaymentLink, token: string | null | undefined): boolean {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 5) return false
  const [version, linkId, linkToken, expiresAtRaw, signature] = parts
  if (version !== ACCESS_TOKEN_VERSION) return false
  if (linkId !== link.id || linkToken !== link.token) return false
  const expiresAt = Number(expiresAtRaw)
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false
  const payload = `${version}.${linkId}.${linkToken}.${expiresAtRaw}`
  const expected = crypto.createHmac('sha256', resolveSecret()).update(payload).digest('base64url')
  if (signature.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

export function buildPaymentLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/pay/${encodeURIComponent(token)}`
}
