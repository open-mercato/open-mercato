import type { APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';
import { readJsonSafe } from './crmFixtures';

export async function submitTextExtraction(
  request: APIRequestContext,
  token: string,
  input?: { text?: string; title?: string; metadata?: Record<string, unknown> },
): Promise<{ ok: boolean; emailId?: string; sourceSubmissionId?: string; error?: string; status: number }> {
  const text = input?.text ?? 'Test email from John Doe <john@example.com> requesting 10 widgets at $5 each.'
  const title = input?.title ?? `QA Fixture ${Date.now()}`

  const response = await apiRequest(request, 'POST', '/api/inbox_ops/extract', {
    token,
    data: { text, title, metadata: input?.metadata },
  });

  const body = await readJsonSafe<{ ok?: boolean; emailId?: string; sourceSubmissionId?: string; error?: string }>(response);
  return {
    ok: response.ok(),
    emailId: body?.emailId ?? undefined,
    sourceSubmissionId: body?.sourceSubmissionId ?? body?.emailId ?? undefined,
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

    const body = await readJsonSafe<{ email?: { status?: string; id?: string } }>(response);
    const status = body?.email?.status

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

export async function waitForSourceSubmissionProposal(
  request: APIRequestContext,
  token: string,
  sourceSubmissionId: string,
  timeoutMs = 30000,
): Promise<{ id: string; sourceSubmissionId: string | null; sourceEntityType: string | null; legacyInboxEmailId: string | null } | null> {
  const pollInterval = 1000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const proposalsResponse = await apiRequest(request, 'GET', '/api/inbox_ops/proposals?pageSize=25', { token });
    if (proposalsResponse.ok()) {
      const proposalsBody = await readJsonSafe<{
        items?: Array<{
          id: string;
          sourceSubmissionId?: string | null;
          sourceEntityType?: string | null;
          legacyInboxEmailId?: string | null;
        }>;
      }>(proposalsResponse);
      const proposal = proposalsBody?.items?.find((p) => p.sourceSubmissionId === sourceSubmissionId);
      if (proposal) {
        return {
          id: proposal.id,
          sourceSubmissionId: proposal.sourceSubmissionId ?? null,
          sourceEntityType: proposal.sourceEntityType ?? null,
          legacyInboxEmailId: proposal.legacyInboxEmailId ?? null,
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  return null
}

export async function deleteInboxProposal(
  request: APIRequestContext,
  token: string,
  proposalId: string,
): Promise<void> {
  await apiRequest(request, 'DELETE', `/api/inbox_ops/proposals/${proposalId}`, { token }).catch(() => {})
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
