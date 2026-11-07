import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/

export function isSafeRelativeReturnPath(value: string): boolean {
  if (!value.startsWith('/')) return false
  if (value.startsWith('//')) return false
  if (CONTROL_OR_BACKSLASH.test(value)) return false
  try {
    const resolved = new URL(value, 'https://return-path.invalid')
    return resolved.origin === 'https://return-path.invalid'
  } catch {
    return false
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost'
}

function readConfiguredOrigins(): string[] {
  const configured = (process.env.CHECKOUT_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
  for (const origin of [process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    if (origin) configured.push(origin)
  }
  return configured
}

export function resolveServerPinnedOrigin(request: Request | null | undefined): string {
  for (const candidate of readConfiguredOrigins()) {
    try {
      return new URL(candidate).origin
    } catch {
      continue
    }
  }
  if (request) {
    const requestUrl = new URL(request.url)
    if (isLoopbackHostname(requestUrl.hostname)) return requestUrl.origin
  }
  throw new CrudHttpError(500, { error: '[internal] Checkout origin is not configured' })
}

export function resolveGatewayReturnUrl(
  returnPath: string | null | undefined,
  request: Request | null | undefined,
): string | undefined {
  if (returnPath === null || returnPath === undefined || returnPath === '') return undefined
  if (!isSafeRelativeReturnPath(returnPath)) {
    throw new CrudHttpError(422, {
      error: '[internal] gateway return URLs must be relative paths',
      code: 'invalid_return_url',
    })
  }
  return `${resolveServerPinnedOrigin(request)}${returnPath}`
}
