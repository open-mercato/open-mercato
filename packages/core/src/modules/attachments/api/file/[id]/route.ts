import { NextRequest, NextResponse } from "next/server";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { getAuthFromRequest } from "@open-mercato/shared/lib/auth/server";
import { createRequestContainer } from "@open-mercato/shared/lib/di/container";
import {
  Attachment,
  AttachmentPartition,
} from "@open-mercato/core/modules/attachments/data/entities";
import type { EntityManager } from "@mikro-orm/postgresql";
import { checkAttachmentAccess } from "@open-mercato/core/modules/attachments/lib/access";
import { z } from "zod";
import { attachmentsTag, attachmentErrorSchema } from "../../openapi";
import {
  buildAttachmentContentDisposition,
  canRenderInlineAttachment,
} from "@open-mercato/core/modules/attachments/lib/security";
import type { StorageDriverFactory } from '../../../lib/drivers';

export const metadata = {
  GET: { requireAuth: false },
};

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { error: "Attachment id is required" },
      { status: 400 },
    );
  }
  const auth = await getAuthFromRequest(req);
  const { resolve } = await createRequestContainer();
  const em = resolve("em") as EntityManager;
  const storageDriverFactory = resolve("storageDriverFactory") as StorageDriverFactory;

  const attachment = await em.findOne(Attachment, { id });
  if (!attachment) {
    return NextResponse.json(
      { error: "Attachment not found" },
      { status: 404 },
    );
  }
  const partition = await em.findOne(AttachmentPartition, {
    code: attachment.partitionCode,
  });
  if (!partition) {
    return NextResponse.json(
      { error: "Partition misconfigured" },
      { status: 500 },
    );
  }

  const access = checkAttachmentAccess(auth, attachment, partition);
  if (!access.ok) {
    const message = access.status === 401 ? "Unauthorized" : "Forbidden";
    return NextResponse.json({ error: message }, { status: access.status });
  }

  const driver = storageDriverFactory.resolveForAttachment(
    attachment.storageDriver,
    partition.configJson,
  );
  let buffer: Buffer;
  try {
    const result = await driver.read(attachment.partitionCode, attachment.storagePath);
    buffer = result.buffer;
  } catch {
    return NextResponse.json({ error: "File not available" }, { status: 404 });
  }

  const url = new URL(req.url);
  const forceDownload = url.searchParams.get("download") === "1";
  const renderInline = !forceDownload && canRenderInlineAttachment(attachment.mimeType);
  const headers: Record<string, string> = {
    "Cache-Control": partition.isPublic
      ? "public, max-age=86400"
      : "private, max-age=60",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Type": renderInline
      ? attachment.mimeType || "application/octet-stream"
      : "application/octet-stream",
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
