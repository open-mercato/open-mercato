import { type APIRequestContext } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export async function getAuthToken(
  request: APIRequestContext,
  email = 'admin@acme.com',
  password = 'secret',
): Promise<string> {
  const form = new URLSearchParams();
  form.set('email', email);
  form.set('password', password);

  const response = await request.post(`${BASE_URL}/api/auth/login`, {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    data: form.toString(),
  });

  const raw = await response.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }

  if (!response.ok() || !body || typeof body.token !== 'string' || !body.token) {
    throw new Error(`Failed to obtain auth token (status ${response.status()})`);
  }

  return body.token;
}

export async function apiRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; data?: unknown },
) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    Authorization: `Bearer ${options.token}`,
    'Content-Type': 'application/json',
  };
  return request.fetch(url, { method, headers, data: options.data });
}
