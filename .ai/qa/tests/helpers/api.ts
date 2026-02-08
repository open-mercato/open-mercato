import { type APIRequestContext } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export async function getAuthToken(
  request: APIRequestContext,
  email = 'admin@acme.com',
  password = 'secret',
): Promise<string> {
  const response = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password },
  });
  const body = await response.json();
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
