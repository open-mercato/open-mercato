import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { UnifiedPaymentStatus } from '@open-mercato/shared/modules/payment_gateways/types'

export const LAUNCH_TOKEN_TTL_MS = 30 * 60 * 1000

const LAUNCH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

export interface LaunchGrant {
  token: string
  expiresAt: string
}

export interface ReturnTargets {
  successUrl: string | null
  cancelUrl: string | null
}

export function createLaunchGrant(now: number = Date.now()): LaunchGrant {
  return {
    token: randomBytes(32).toString('base64url'),
    expiresAt: new Date(now + LAUNCH_TOKEN_TTL_MS).toISOString(),
  }
}

export function isWellFormedLaunchToken(value: string): boolean {
  return LAUNCH_TOKEN_PATTERN.test(value)
}

export function isWellFormedOrderId(value: string): boolean {
  return ORDER_ID_PATTERN.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function launchGrantMatches(stored: unknown, presentedToken: string, now: number = Date.now()): boolean {
  if (!isRecord(stored)) return false
  const { token, expiresAt } = stored
  if (typeof token !== 'string' || typeof expiresAt !== 'string') return false
  const expiry = Date.parse(expiresAt)
  if (!Number.isFinite(expiry) || expiry <= now) return false
  const storedBytes = Buffer.from(token, 'utf8')
  const presentedBytes = Buffer.from(presentedToken, 'utf8')
  return storedBytes.length === presentedBytes.length && timingSafeEqual(storedBytes, presentedBytes)
}

export function buildLaunchPath(orderId: string, token: string): string {
  return `/api/gateway_autopay/launch?o=${encodeURIComponent(orderId)}&t=${token}`
}

export function readHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

export function resolveLaunchUrl(launchPath: string, successUrl: string | undefined): string {
  const absolute = readHttpUrl(successUrl)
  return absolute ? `${new URL(absolute).origin}${launchPath}` : launchPath
}

export function readReturnTargets(value: unknown): ReturnTargets {
  const record = isRecord(value) ? value : {}
  return { successUrl: readHttpUrl(record.successUrl), cancelUrl: readHttpUrl(record.cancelUrl) }
}

const CANCEL_STATUSES: ReadonlySet<UnifiedPaymentStatus> = new Set(['failed', 'cancelled', 'expired'])

export function pickReturnTarget(status: UnifiedPaymentStatus, targets: ReturnTargets): string | null {
  return CANCEL_STATUSES.has(status) ? targets.cancelUrl : targets.successUrl
}

export interface FormPostDescriptor {
  url: string
  fields: Record<string, string>
}

export function readFormPost(value: unknown): FormPostDescriptor | null {
  if (!isRecord(value) || typeof value.url !== 'string' || !isRecord(value.fields)) return null
  const fields: Record<string, string> = {}
  for (const [name, fieldValue] of Object.entries(value.fields)) {
    if (typeof fieldValue !== 'string') return null
    fields[name] = fieldValue
  }
  return { url: value.url, fields }
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character])
}

export interface LaunchPageCopy {
  title: string
  message: string
  continueLabel: string
}

export function renderLaunchPage(form: FormPostDescriptor, copy: LaunchPageCopy): string {
  const hiddenInputs = Object.entries(form.fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('')
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(copy.title)}</title>
</head>
<body>
<form id="autopay-launch" method="POST" action="${escapeHtml(form.url)}">${hiddenInputs}
<p>${escapeHtml(copy.message)}</p>
<button type="submit">${escapeHtml(copy.continueLabel)}</button>
</form>
<script>document.getElementById('autopay-launch').submit()</script>
</body>
</html>`
}

export function renderMessagePage(copy: { title: string; message: string }): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(copy.title)}</title>
</head>
<body>
<h1>${escapeHtml(copy.title)}</h1>
<p>${escapeHtml(copy.message)}</p>
</body>
</html>`
}

export const LAUNCH_PAGE_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'form-action https:',
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

export const NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}
