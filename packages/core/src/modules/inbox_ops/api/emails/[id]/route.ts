import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { InboxEmail } from '../../../data/entities'
import {
  resolveRequestContext,
  extractPathSegment,
  UnauthorizedError,
} from '../../routeHelpers'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { canViewEmailContent, serializeInboxEmail } from '../response'
import {
  releaseInboundEmailAttachments,
  softDeleteInboxEmailForRelease,
  type InboundAttachmentReleaseService,
} from '../../../lib/inboundAttachmentRelease'
import { reportInboundAttachmentError } from '../../../lib/inboundAttachments'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

const logger = createLogger('inbox_ops').child({ component: 'emails' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.log.view'] },
  DELETE: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.manage'] },
}

function tryResolve<T>(container: { resolve: (name: string) => unknown }, name: string): T | null {
  try {
    return (container.resolve(name) as T | undefined) ?? null
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const id = extractPathSegment(url, 'emails')

    if (!id) {
      return NextResponse.json({ error: 'Missing email ID' }, { status: 400 })
    }

    const ctx = await resolveRequestContext(req)

    const email = await findOneWithDecryption(
      ctx.em,
      InboxEmail,
      {
        id,
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        deletedAt: null,
      },
      undefined,
      ctx.scope,
    )

    if (!email) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 })
    }

    const includeContent = await canViewEmailContent(ctx)
    return NextResponse.json({ email: serializeInboxEmail(email, includeContent) })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('Failed to load email detail', { err })
    return NextResponse.json({ error: 'Failed to load email' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url)
    const id = extractPathSegment(url, 'emails')

    if (!id) {
      return NextResponse.json({ error: 'Missing email ID' }, { status: 400 })
    }

    const ctx = await resolveRequestContext(req)

    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      resourceKind: 'inbox_ops:inbox_email',
      resourceId: id,
      operation: 'delete',
      requestMethod: req.method,
      requestHeaders: req.headers,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const deleted = await softDeleteInboxEmailForRelease(ctx.em, {
      id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })

    if (!deleted) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 })
    }

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        resourceKind: 'inbox_ops:inbox_email',
        resourceId: id,
        operation: 'delete',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    try {
      await releaseInboundEmailAttachments({
        em: ctx.em,
        email: { id, tenantId: ctx.tenantId, organizationId: ctx.organizationId },
        attachmentService: tryResolve<InboundAttachmentReleaseService>(ctx.container, 'attachmentService'),
        encryptionService: tryResolve<TenantDataEncryptionService>(ctx.container, 'tenantEncryptionService'),
      })
    } catch (releaseError) {
      logger.warn('Deferred the attachment release of a deleted email to the maintenance sweep', { emailId: id, err: releaseError })
      reportInboundAttachmentError(releaseError, 'inbox_ops.attachment_release_failed', { emailId: id })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('Failed to delete email', { err })
    return NextResponse.json({ error: 'Failed to delete email' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Email detail',
  methods: {
    GET: {
      summary: 'Get email detail with parsed thread',
      responses: [
        { status: 200, description: 'Email detail' },
        { status: 404, description: 'Email not found' },
      ],
    },
    DELETE: {
      summary: 'Soft-delete an inbox email',
      responses: [
        { status: 200, description: 'Email deleted' },
        { status: 404, description: 'Email not found' },
      ],
    },
  },
}
