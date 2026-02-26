import type { APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';
import { readJsonSafe } from './crmFixtures';

export async function submitTextExtraction(
  request: APIRequestContext,
  token: string,
  input?: { text?: string; title?: string; metadata?: Record<string, unknown> },
): Promise<{ ok: boolean; emailId?: string; error?: string; status: number }> {
  const text = input?.text ?? 'Test email from John Doe <john@example.com> requesting 10 widgets at $5 each.'
  const title = input?.title ?? `QA Fixture ${Date.now()}`

  const response = await apiRequest(request, 'POST', '/api/inbox_ops/extract', {
    token,
    data: { text, title, metadata: input?.metadata },
  });

  const body = await readJsonSafe<{ ok?: boolean; emailId?: string; error?: string }>(response);
  return {
    ok: response.ok(),
    emailId: body?.emailId ?? undefined,
    error: body?.error ?? undefined,
    status: response.status(),
  };
}

export async function waitForEmailProcessed(
  request: APIRequestContext,
  token: string,
  emailId: string,
  timeoutMs = 30000,
): Promise<{ status: string; proposalId?: string } | null> {
  const pollInterval = 1000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const response = await apiRequest(request, 'GET', `/api/inbox_ops/emails/${emailId}`, { token });
    if (!response.ok()) return null

    const body = await readJsonSafe<{ status?: string; id?: string }>(response);
    const status = body?.status

    if (status === 'processed' || status === 'needs_review' || status === 'failed') {
      const proposalsResponse = await apiRequest(request, 'GET', '/api/inbox_ops/proposals?pageSize=5', { token });
      const proposalsBody = await readJsonSafe<{ items?: Array<{ id: string; inboxEmailId?: string }> }>(proposalsResponse);
      const proposal = proposalsBody?.items?.find((p) => p.inboxEmailId === emailId);
      return { status, proposalId: proposal?.id };
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  return null
}

export async function deleteInboxEmail(
  request: APIRequestContext,
  token: string,
  emailId: string,
): Promise<void> {
  await apiRequest(request, 'DELETE', `/api/inbox_ops/emails/${emailId}`, { token }).catch(() => {})
}

export async function listInboxEmails(
  request: APIRequestContext,
  token: string,
  params?: { status?: string; page?: number; pageSize?: number },
): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));

  const path = `/api/inbox_ops/emails${searchParams.toString() ? `?${searchParams}` : ''}`;
  const response = await apiRequest(request, 'GET', path, { token });
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>>; total?: number }>(response);
  return { items: body?.items ?? [], total: body?.total ?? 0 };
}

export async function listInboxProposals(
  request: APIRequestContext,
  token: string,
  params?: { status?: string; page?: number; pageSize?: number },
): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));

  const path = `/api/inbox_ops/proposals${searchParams.toString() ? `?${searchParams}` : ''}`;
  const response = await apiRequest(request, 'GET', path, { token });
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>>; total?: number }>(response);
  return { items: body?.items ?? [], total: body?.total ?? 0 };
}
