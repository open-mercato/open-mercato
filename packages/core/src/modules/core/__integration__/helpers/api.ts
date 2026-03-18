import type { APIRequestContext, APIResponse } from '@playwright/test'
import { DEFAULT_CREDENTIALS, type Role } from './auth'

const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

export async function getAuthToken(
  request: APIRequestContext,
  roleOrEmail: Role | string = 'admin',
  password?: string,
): Promise<string> {
  const role = roleOrEmail in DEFAULT_CREDENTIALS ? (roleOrEmail as Role) : null
  const credentialAttempts: Array<{ email: string; password: string }> = []

  if (role) {
    const configured = DEFAULT_CREDENTIALS[role]
    credentialAttempts.push({
      email: configured.email,
      password: password ?? configured.password,
    })
    if (!password) {
      credentialAttempts.push({ email: `${role}@acme.com`, password: 'secret' })
    }
  } else {
    credentialAttempts.push({ email: roleOrEmail, password: password ?? 'secret' })
  }

  let lastStatus = 0
  for (const attempt of credentialAttempts) {
    const form = new URLSearchParams()
    form.set('email', attempt.email)
    form.set('password', attempt.password)

    const response = await request.post(resolveUrl('/api/auth/login'), {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      data: form.toString(),
    })

    const raw = await response.text()
    let body: Record<string, unknown> | null = null
    try {
      body = raw ? JSON.parse(raw) : null
    } catch {
      body = null
    }

    lastStatus = response.status()
    if (response.ok() && body && typeof body.token === 'string' && body.token) {
      return body.token
    }
  }

  throw new Error(`Failed to obtain auth token (status ${lastStatus})`)
}

export async function apiRequest(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  options: { token: string; data?: unknown },
): Promise<APIResponse> {
  const headers = {
    Authorization: `Bearer ${options.token}`,
    'Content-Type': 'application/json',
  }
  return request.fetch(resolveUrl(path), { method, headers, data: options.data })
}

export async function postForm(
  request: APIRequestContext,
  path: string,
  data: Record<string, string>,
  options?: { headers?: Record<string, string> },
): Promise<APIResponse> {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries(data)) form.set(key, value)
  return request.post(resolveUrl(path), {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(options?.headers ?? {}),
    },
    data: form.toString(),
  })
}
