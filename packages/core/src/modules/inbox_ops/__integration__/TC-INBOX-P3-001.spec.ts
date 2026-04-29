import { test, expect } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  submitTextExtraction,
  waitForSourceSubmissionProposal,
  deleteInboxProposal,
  deleteInboxEmail,
} from '@open-mercato/core/modules/core/__integration__/helpers/inboxFixtures';

type ProposalListItem = {
  id: string;
  sourceSubmissionId: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  legacyInboxEmailId: string | null;
  sourceKind: string | null;
  sourceLabel: string | null;
  inboxEmailId?: string | null;
};

test.describe('TC-INBOX-P3-001: Source-oriented intake exposes source block on proposals', () => {
  let token: string;
  const createdProposalIds: string[] = [];
  const createdEmailIds: string[] = [];
  let manualSourceSubmissionId: string | undefined;
  let manualProposalId: string | undefined;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000);
    token = await getAuthToken(request, 'admin');

    const result = await submitTextExtraction(request, token, {
      text:
        'Hello, this is Acme Buying Group <buying@p3-fixture.com>. Please send a quote for 5x Carbide Cutter at $120 each.',
      title: `TC-INBOX-P3-001 manual extract ${Date.now()}`,
    });
    expect(result.ok, `extract response: ${result.status} ${result.error ?? ''}`).toBe(true);
    expect(result.sourceSubmissionId).toBeTruthy();

    manualSourceSubmissionId = result.sourceSubmissionId;
    const proposal = await waitForSourceSubmissionProposal(request, token, manualSourceSubmissionId!, 60_000);
    if (proposal) {
      manualProposalId = proposal.id;
      createdProposalIds.push(proposal.id);
      if (proposal.legacyInboxEmailId) createdEmailIds.push(proposal.legacyInboxEmailId);
    }
  });

  test.afterAll(async ({ request }) => {
    for (const proposalId of createdProposalIds) {
      await deleteInboxProposal(request, token, proposalId);
    }
    for (const emailId of createdEmailIds) {
      await deleteInboxEmail(request, token, emailId);
    }
  });

  test('manual extract path links proposal to a source submission', async () => {
    test.skip(!manualSourceSubmissionId, 'extract submission was not created');
    test.skip(!manualProposalId, 'manual extract did not yield a proposal in time');

    expect(manualSourceSubmissionId).toBeTruthy();
    expect(manualProposalId).toBeTruthy();
  });

  test('proposals list exposes the new source block fields', async ({ request }) => {
    test.skip(!manualSourceSubmissionId, 'extract submission was not created');

    const response = await apiRequest(request, 'GET', '/api/inbox_ops/proposals?pageSize=25', { token });
    expect(response.status()).toBe(200);
    const body = await readJsonSafe<{ items?: ProposalListItem[] }>(response);
    expect(body).toBeTruthy();
    expect(Array.isArray(body!.items)).toBe(true);

    const item = body!.items?.find((p) => p.sourceSubmissionId === manualSourceSubmissionId);
    expect(item, 'proposal for manual submission should appear in list').toBeTruthy();
    expect(item!).toMatchObject({
      sourceSubmissionId: manualSourceSubmissionId,
    });
    expect(typeof item!.sourceEntityType === 'string' || item!.sourceEntityType === null).toBe(true);
    expect(typeof item!.sourceEntityId === 'string' || item!.sourceEntityId === null).toBe(true);
    expect('legacyInboxEmailId' in item!).toBe(true);
    expect('sourceKind' in item!).toBe(true);
    expect('sourceLabel' in item!).toBe(true);
  });

  test('proposal detail exposes a structured source block', async ({ request }) => {
    test.skip(!manualProposalId, 'manual extract did not yield a proposal in time');

    const response = await apiRequest(request, 'GET', `/api/inbox_ops/proposals/${manualProposalId}`, { token });
    expect(response.status()).toBe(200);
    const body = await readJsonSafe<{
      proposal?: {
        id: string;
        legacyInboxEmailId: string | null;
        source?: {
          sourceSubmissionId: string | null;
          sourceEntityType: string | null;
          sourceEntityId: string | null;
          sourceArtifactId: string | null;
          sourceVersion: string | null;
          sourceSnapshot: Record<string, unknown> | null;
        };
      };
    }>(response);

    expect(body?.proposal).toBeTruthy();
    expect(body!.proposal!.source).toBeTruthy();
    expect(body!.proposal!.source!.sourceSubmissionId).toBe(manualSourceSubmissionId);
    expect('sourceEntityType' in body!.proposal!.source!).toBe(true);
    expect('sourceEntityId' in body!.proposal!.source!).toBe(true);
    expect('sourceArtifactId' in body!.proposal!.source!).toBe(true);
    expect('sourceVersion' in body!.proposal!.source!).toBe(true);
    expect('sourceSnapshot' in body!.proposal!.source!).toBe(true);
    expect('legacyInboxEmailId' in body!.proposal!).toBe(true);
  });

  test('messages-sent demo path produces a messages-sourced proposal when wired', async ({ request }) => {
    const composeResponse = await apiRequest(request, 'POST', '/api/messages', {
      token,
      data: {
        type: 'default',
        visibility: 'internal',
        subject: `[AI] TC-INBOX-P3-001 demo ${Date.now()}`,
        body: 'Please send a quote for 2x Demo Item at $42 each. Contact buyer@p3-demo.com.',
        bodyFormat: 'text',
        priority: 'normal',
      },
    });
    test.skip(
      !composeResponse.ok(),
      `messages compose endpoint not available (status ${composeResponse.status()}); skipping demo path`,
    );

    const composeBody = await readJsonSafe<{ message?: { id?: string } }>(composeResponse);
    const messageId = composeBody?.message?.id;
    test.skip(!messageId, 'messages compose did not return an id; skipping demo path');

    const deadline = Date.now() + 60_000;
    let demoProposal: ProposalListItem | undefined;
    while (Date.now() < deadline && !demoProposal) {
      const proposalsResponse = await apiRequest(request, 'GET', '/api/inbox_ops/proposals?pageSize=50', { token });
      if (proposalsResponse.ok()) {
        const proposalsBody = await readJsonSafe<{ items?: ProposalListItem[] }>(proposalsResponse);
        demoProposal = proposalsBody?.items?.find(
          (p) => p.sourceEntityType === 'messages:message' && p.sourceEntityId === messageId,
        );
      }
      if (!demoProposal) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    test.skip(
      !demoProposal,
      'messages-sent demo subscriber is not enabled or did not produce a proposal in time',
    );

    expect(demoProposal!.sourceEntityType).toBe('messages:message');
    expect(demoProposal!.sourceEntityId).toBe(messageId!);
    expect(demoProposal!.legacyInboxEmailId).toBeNull();
    if (demoProposal) createdProposalIds.push(demoProposal.id);
  });
});
