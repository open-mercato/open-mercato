import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxProposalAction, InboxDiscrepancy, InboxEmail } from '../../../data/entities'
import {
  resolveRequestContext,
  resolveProposal,
  handleRouteError,
  isErrorResponse,
} from '../../routeHelpers'
import { proposalDetailResponseSchema } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.view'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveRequestContext(req)
    const proposal = await resolveProposal(new URL(req.url), ctx)
    if (isErrorResponse(proposal)) return proposal

    const [actions, discrepancies, email] = await Promise.all([
      findWithDecryption(
        ctx.em,
        InboxProposalAction,
        { proposalId: proposal.id, organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null },
        { orderBy: { sortOrder: 'ASC' } },
        ctx.scope,
      ),
      findWithDecryption(
        ctx.em,
        InboxDiscrepancy,
        { proposalId: proposal.id, organizationId: ctx.organizationId, tenantId: ctx.tenantId, deletedAt: null },
        { orderBy: { createdAt: 'ASC' } },
        ctx.scope,
      ),
      proposal.inboxEmailId
        ? findOneWithDecryption(
            ctx.em,
            InboxEmail,
            {
              id: proposal.inboxEmailId,
              organizationId: ctx.organizationId,
              tenantId: ctx.tenantId,
              deletedAt: null,
            },
            undefined,
            ctx.scope,
          )
        : Promise.resolve(null),
    ])

    return NextResponse.json({
      proposal: {
        ...proposal,
        source: {
          sourceSubmissionId: proposal.sourceSubmissionId ?? null,
          sourceEntityType: proposal.sourceEntityType ?? null,
          sourceEntityId: proposal.sourceEntityId ?? null,
          sourceArtifactId: proposal.sourceArtifactId ?? null,
          sourceVersion: proposal.sourceVersion ?? null,
          sourceSnapshot: proposal.sourceSnapshot ?? null,
        },
        legacyInboxEmailId: proposal.inboxEmailId ?? null,
      },
      actions,
      discrepancies,
      email,
    })
  } catch (err) {
    return handleRouteError(err, 'load proposal')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Proposal detail',
  methods: {
    GET: {
      summary: 'Get proposal detail',
      description: 'Returns proposal with actions, discrepancies, and source email',
      responses: [
        { status: 200, description: 'Full proposal detail', schema: proposalDetailResponseSchema },
        { status: 404, description: 'Proposal not found' },
      ],
    },
  },
}
