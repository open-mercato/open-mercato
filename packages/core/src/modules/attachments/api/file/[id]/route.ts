import { NextRequest, NextResponse } from "next/server";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { getAuthFromRequest } from "@open-mercato/shared/lib/auth/server";
import { createRequestContainer } from "@open-mercato/shared/lib/di/container";
import {
  Attachment,
  AttachmentPartition,
} from "@open-mercato/core/modules/attachments/data/entities";
import type { EntityManager } from "@mikro-orm/postgresql";
import { checkAttachmentAccess, isSuperAdminAuth } from "@open-mercato/core/modules/attachments/lib/access";
import { z } from "zod";
import { attachmentsTag, attachmentErrorSchema } from "../../openapi";
import {
  buildAttachmentContentDisposition,
  canRenderInlineAttachment,
} from "@open-mercato/core/modules/attachments/lib/security";
import {
  DEFAULT_ATTACHMENT_CONTENT_SECURITY_POLICY,
  isTrustedVectorImage,
  VECTOR_IMAGE_CONTENT_SECURITY_POLICY,
  VECTOR_IMAGE_MIME_TYPE,
} from "@open-mercato/core/modules/attachments/lib/vector-image";
import { StorageDriverFactory } from '../../../lib/drivers';
import { resolveAttachmentRequestScope } from '@open-mercato/core/modules/attachments/lib/requestScope';

function jsonResponse(body: { error: string }, init: { status: number }) {
  return NextResponse.json(body, {
    status: init.status,
    headers: {
      "Content-Security-Policy": DEFAULT_ATTACHMENT_CONTENT_SECURITY_POLICY,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * `next.config.ts` gives this path its sandboxing CSP by matching the raw,
 * still percent-encoded pathname, and that header wins over the route's own.
 * The API dispatcher decodes segments, so `/api/attachments/%66ile/{id}` or
 * `/api/%61ttachments/file/{id}` reach this route while the header rule does
 * not match them and the app CSP applies instead. A sanitised SVG is served
 * inline only when the request used the exact canonical path; any other
 * spelling gets a download.
 */
function isCanonicalFilePath(url: URL, id: string): boolean {
  return url.pathname === `/api/attachments/file/${encodeURIComponent(id)}`;
}

export const metadata = {
  GET: { requireAuth: false },
};

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id) {
    return jsonResponse(
      { error: "Attachment id is required" },
      { status: 400 },
    );
  }
  const auth = await getAuthFromRequest(req);
  const container = await createRequestContainer();
  const em = container.resolve("em") as EntityManager;
  const storageDriverFactory =
    (container.resolve("storageDriverFactory") as StorageDriverFactory | null) ??
    new StorageDriverFactory(em);

  const requestScope = await resolveAttachmentRequestScope(container, auth, req);
  if (requestScope.denied) {
    return jsonResponse(
      { error: "Attachment not found" },
      { status: 404 },
    );
  }
  const scopedAuth = auth ? { ...auth, orgId: requestScope.organizationId } : auth;
  const findFilter: Record<string, unknown> = { id };
  if (scopedAuth && !isSuperAdminAuth(scopedAuth)) {
    if (scopedAuth.tenantId) findFilter.tenantId = scopedAuth.tenantId;
    if (scopedAuth.orgId) findFilter.organizationId = scopedAuth.orgId;
  }
  const attachment = await em.findOne(Attachment, findFilter);
  if (!attachment) {
    return jsonResponse(
      { error: "Attachment not found" },
      { status: 404 },
    );
  }
  const partition = await em.findOne(AttachmentPartition, {
    code: attachment.partitionCode,
  });
  if (!partition) {
    return jsonResponse(
      { error: "Partition misconfigured" },
      { status: 500 },
    );
  }

  const access = checkAttachmentAccess(scopedAuth, attachment, partition);
  if (!access.ok) {
    const message = access.status === 401 ? "Unauthorized" : "Forbidden";
    return jsonResponse({ error: message }, { status: access.status });
  }

  const driver = await storageDriverFactory.resolveForPartition(attachment.partitionCode, {
    tenantId: attachment.tenantId ?? '',
    organizationId: attachment.organizationId ?? '',
  });
  let buffer: Buffer;
  try {
    const result = await driver.read(attachment.partitionCode, attachment.storagePath);
    buffer = result.buffer;
  } catch {
    return jsonResponse({ error: "File not available" }, { status: 404 });
  }

  const url = new URL(req.url);
  const forceDownload = url.searchParams.get("download") === "1";
  const vectorImage =
    isCanonicalFilePath(url, id) && isTrustedVectorImage(attachment, buffer);
  const renderInline =
    !forceDownload && (vectorImage || canRenderInlineAttachment(attachment.mimeType));
  const inlineContentType = vectorImage
    ? VECTOR_IMAGE_MIME_TYPE
    : attachment.mimeType || "application/octet-stream";
  const headers: Record<string, string> = {
    "Cache-Control": partition.isPublic
      ? "public, max-age=86400"
      : "private, max-age=60",
    "Content-Security-Policy": vectorImage
      ? VECTOR_IMAGE_CONTENT_SECURITY_POLICY
      : DEFAULT_ATTACHMENT_CONTENT_SECURITY_POLICY,
    "Content-Type": renderInline ? inlineContentType : "application/octet-stream",
    "Content-Disposition": buildAttachmentContentDisposition(
      attachment.fileName,
      renderInline ? "inline" : "attachment",
    ),
    "X-Content-Type-Options": "nosniff",
  };
  if (attachment.fileSize > 0) {
    headers["Content-Length"] = String(attachment.fileSize);
  }

  const responseBody = new Uint8Array(buffer);

  return new NextResponse(responseBody, { status: 200, headers });
}

export const openApi: OpenApiRouteDoc = {
  tag: attachmentsTag,
  summary: "Download attachment file",
  methods: {
    GET: {
      summary: "Download or serve attachment file",
      description:
        "Returns the raw file content for an attachment. Path parameter: {id} - Attachment UUID. Query parameter: ?download=1 - Force file download with Content-Disposition header. Access control is enforced based on partition settings.",
      responses: [
        {
          status: 200,
          description: "File content with appropriate MIME type",
          schema: z.any().describe("Binary file content"),
        },
      ],
      errors: [
        {
          status: 400,
          description: "Missing attachment ID",
          schema: attachmentErrorSchema,
        },
        {
          status: 401,
          description:
            "Unauthorized - authentication required for private partitions",
          schema: attachmentErrorSchema,
        },
        {
          status: 403,
          description: "Forbidden - insufficient permissions",
          schema: attachmentErrorSchema,
        },
        {
          status: 404,
          description: "Attachment or file not found",
          schema: attachmentErrorSchema,
        },
        {
          status: 500,
          description: "Partition misconfigured",
          schema: attachmentErrorSchema,
        },
      ],
    },
  },
};
