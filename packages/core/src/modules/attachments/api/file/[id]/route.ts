import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { getAuthFromRequest } from "@open-mercato/shared/lib/auth/server";
import { createRequestContainer } from "@open-mercato/shared/lib/di/container";
import {
  Attachment,
  AttachmentPartition,
} from "@open-mercato/core/modules/attachments/data/entities";
import { resolveAttachmentAbsolutePath } from "@open-mercato/core/modules/attachments/lib/storage";
import type { EntityManager } from "@mikro-orm/postgresql";
import { checkAttachmentAccess } from "@open-mercato/core/modules/attachments/lib/access";
import { z } from "zod";
import { attachmentsTag, attachmentErrorSchema } from "../../openapi";

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

  const filePath = resolveAttachmentAbsolutePath(
    attachment.partitionCode,
    attachment.storagePath,
    attachment.storageDriver,
  );
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    return NextResponse.json({ error: "File not available" }, { status: 404 });
  }

  const url = new URL(req.url);
  const forceDownload = url.searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "Content-Type": attachment.mimeType || "application/octet-stream",
    "Cache-Control": partition.isPublic
      ? "public, max-age=86400"
      : "private, max-age=60",
  };
  if (attachment.fileSize > 0) {
    headers["Content-Length"] = String(attachment.fileSize);
  }
  if (forceDownload) {
    headers["Content-Disposition"] =
      `attachment; filename="${encodeURIComponent(attachment.fileName)}"`;
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
