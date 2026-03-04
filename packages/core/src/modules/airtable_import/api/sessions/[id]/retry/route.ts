import { NextResponse } from "next/server";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { resolveSessionContext, isErrorResponse } from "../../../../lib/api-helpers";
import { extractApiKeyFromRequest } from "../../../../lib/extract-api-token";

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ["airtable_import.manage"] },
};

export const openApi: OpenApiRouteDoc = {
  tag: "Airtable Import",
  methods: {
    POST: { summary: "Retry import for failed records" },
  },
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const omApiKey = extractApiKeyFromRequest(req);

  if (!omApiKey)
    return NextResponse.json({ error: "Missing session token" }, { status: 401 });

  const ctx = await resolveSessionContext(req, params);
  if (isErrorResponse(ctx)) return ctx;
  const { auth, session, em } = ctx;

  if (!session.progressJson || !session.reportJson) {
    return NextResponse.json(
      { error: "Not found or not completed" },
      { status: 404 },
    );
  }

  if (session.status === "importing") {
    return NextResponse.json(
      { error: "Import already in progress — wait for it to finish" },
      { status: 422 },
    );
  }

  const retryAirtableIds: Record<string, string[]> = {};
  for (const [tableId, tableProgress] of Object.entries(
    session.progressJson.tables,
  )) {
    const toRetry = Object.entries(tableProgress.records)
      .filter(
        ([, rec]) =>
          rec.status === "failed" || rec.status === "needs_attention",
      )
      .map(([airtableId]) => airtableId);
    if (toRetry.length > 0) retryAirtableIds[tableId] = toRetry;
  }

  if (Object.keys(retryAirtableIds).length === 0) {
    return NextResponse.json({
      ok: true,
      message: "No records to retry",
    });
  }

  session.status = "importing";
  await em.flush();

  const omUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const queueStrategy = (process.env.QUEUE_STRATEGY ?? "local") as
    | "local"
    | "async";
  const { createQueue } = await import("@open-mercato/queue");
  const queue = createQueue("airtable-import", queueStrategy);
  await queue.enqueue({
    sessionId: session.id,
    tenantId: auth.tenantId,
    omUrl,
    omApiKey,
    isRetry: true,
    retryAirtableIds,
  });

  return NextResponse.json({
    ok: true,
    retryCount: Object.values(retryAirtableIds).flat().length,
  });
}
