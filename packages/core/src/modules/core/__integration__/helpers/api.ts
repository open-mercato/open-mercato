import fs from 'node:fs';
import path from 'node:path';
import { type APIRequestContext } from '@playwright/test';
import { DEFAULT_CREDENTIALS, type Role } from './auth';

function resolveEphemeralBaseUrl(): string | null {
  try {
    const filePath = path.resolve(process.cwd(), '.ai/qa/ephemeral-env.json');
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { status?: string; baseUrl?: unknown };
    if (parsed.status !== 'running') return null;
    return typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim().length
      ? parsed.baseUrl.trim()
      : null;
  } catch {
    return null;
  }
}

const BASE_URL =
  process.env.BASE_URL?.trim() ||
  resolveEphemeralBaseUrl() ||
  'http://localhost:3000';

export async function getAuthToken(
  request: APIRequestContext,
  roleOrEmail: Role | string = 'admin',
  password?: string,
): Promise<string> {
  let email: string;
  let pass: string;
  if (roleOrEmail in DEFAULT_CREDENTIALS) {
    const creds = DEFAULT_CREDENTIALS[roleOrEmail as Role];
    email = creds.email;
    pass = password ?? creds.password;
  } else {
    email = roleOrEmail;
    pass = password ?? 'secret';
  }
  const form = new URLSearchParams();
  form.set('email', email);
  form.set('password', pass);

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
