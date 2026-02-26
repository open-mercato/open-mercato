import { NextResponse } from "next/server";
import type { EntityManager } from "@mikro-orm/postgresql";
import { createRequestContainer } from "@open-mercato/shared/lib/di/container";
import { getAuthFromRequest } from "@open-mercato/shared/lib/auth/server";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { ImportSession } from "../../../../data/entities";

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ["airtable_import.manage"] },
};

export const openApi: OpenApiRouteDoc = {
  tag: "Airtable Import",
  methods: {
    POST: { summary: "Start import execution" },
  },
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthFromRequest(req);
  if (!auth?.tenantId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const omUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  // Use the session JWT token so the worker can call OM APIs without a manual API key
  const authHeader = req.headers.get("authorization") ?? "";
  const cookieHeader = req.headers.get("cookie") ?? "";
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
  const omApiKey = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : cookieMatch
      ? decodeURIComponent(cookieMatch[1])
      : null;

  if (!omApiKey)
    return NextResponse.json({ error: "Brak tokenu sesji" }, { status: 401 });

  const { id } = await params;
  const container = await createRequestContainer();
  const em = container.resolve<EntityManager>("em");
  const session = await em.findOne(ImportSession, {
    id,
    tenantId: auth.tenantId,
  });
  if (!session)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!session.planJson)
    return NextResponse.json(
      { error: "Wygeneruj plan przed uruchomieniem importu" },
      { status: 422 },
    );

  if (!session.mappingJson)
    return NextResponse.json(
      { error: "Uzupełnij mapowanie przed uruchomieniem importu" },
      { status: 422 },
    );

  // overwriteExisting=true → full re-import; false (default) → skip already-done records
  const preserveDone = !session.configJson?.overwriteExisting;

  // Track whether this is a partial re-run (done records preserved) so the worker
  // knows NOT to reset progressJson on startup.
  let isRetryRun = false;

  // Allow re-running a completed/cancelled/failed session
  if (
    session.status === "done" ||
    session.status === "failed" ||
    session.status === "cancelled"
  ) {
    if (preserveDone && session.progressJson) {
      // Partial re-run: keep done records in each table, reset failed/attention so they're re-processed
      const updatedTables: typeof session.progressJson.tables = {};
      for (const [tableId, table] of Object.entries(
        session.progressJson.tables,
      )) {
        const doneRecords = Object.fromEntries(
          Object.entries(table.records).filter(([, r]) => r.status === "done"),
        );
        updatedTables[tableId] = {
          ...table,
          done: Object.keys(doneRecords).length,
          failed: 0,
          needsAttention: 0,
          records: doneRecords,
        };
      }
      session.progressJson = {
        ...session.progressJson,
        tables: updatedTables,
        currentTable: null,
      };
      isRetryRun = true;
    } else {
      // Full re-import: clear all progress
      session.progressJson = null;
    }
    session.reportJson = null;
  }

  session.status = "importing";
  session.currentStep = 7;
  await em.flush();

  const queueStrategy = (process.env.QUEUE_STRATEGY ?? "local") as
    | "local"
    | "async";
  const { createQueue } = await import("@open-mercato/queue");
  const queue = createQueue("airtable-import", queueStrategy);
  // isRetry=true tells the worker NOT to reset progressJson on startup.
  // retryAirtableIds is intentionally omitted here: the execute route already
  // stripped failed/attention records from progressJson above, so the worker's
  // "skip done records" filter naturally re-processes them without needing an
  // explicit ID list (as opposed to retry/route.ts which passes retryAirtableIds
  // because it preserves the existing progressJson untouched).
  await queue.enqueue({
    sessionId: session.id,
    tenantId: auth.tenantId,
    omUrl,
    omApiKey,
    isRetry: isRetryRun,
  });

  return NextResponse.json({ ok: true, sessionId: session.id });
}
