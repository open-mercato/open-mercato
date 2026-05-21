/**
 * Public runtime principal guard — phase 2d.
 *
 * Resolves the acting principal for a public-runtime submission request from
 * EITHER a submission access token (`Authorization: Bearer <token>`) OR a
 * portal customer session, in that order.
 *
 * Critical invariant (R-2d-4): when the principal comes from an access token,
 * the org/tenant are NEVER trusted from the token body — they are re-derived
 * from the persisted `forms_form_submission` row. The token only authorizes a
 * single `(submissionId, invitationId, role)` triple; it asserts the token's
 * submission matches the route's submission before trusting anything.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { FormSubmission } from '../data/entities'
import { verifyAccessToken } from '../services/distribution-token'

export type RuntimePrincipal = {
  source: 'token' | 'customer'
  principal: string
  role: string | null
  organizationId: string
  tenantId: string
  submissionId: string
}

export type ResolveRuntimePrincipalArgs = {
  req: Request
  submissionId: string
  em: EntityManager
}

function readBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match) return null
  const token = match[1].trim()
  return token.length > 0 ? token : null
}

export async function resolveRuntimePrincipal(
  args: ResolveRuntimePrincipalArgs,
): Promise<RuntimePrincipal | null> {
  const { req, submissionId, em } = args

  const bearer = readBearerToken(req)
  if (bearer) {
    const verified = verifyAccessToken(bearer)
    if (verified.ok && verified.submissionId === submissionId && verified.invitationId) {
      const submission = await em.findOne(FormSubmission, {
        id: submissionId,
        deletedAt: null,
      })
      if (submission) {
        return {
          source: 'token',
          principal: verified.invitationId,
          role: verified.role ?? null,
          organizationId: submission.organizationId,
          tenantId: submission.tenantId,
          submissionId,
        }
      }
    }
    // A present-but-invalid bearer token does not fall through to customer
    // auth — it is an explicit (failed) authorization attempt.
    return null
  }

  const auth = await getCustomerAuthFromRequest(req)
  if (auth) {
    return {
      source: 'customer',
      principal: auth.sub,
      role: null,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      submissionId,
    }
  }

  return null
}
