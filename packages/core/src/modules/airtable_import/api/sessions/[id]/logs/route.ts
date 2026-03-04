import { getAuthFromRequest } from "@open-mercato/shared/lib/auth/server";
import { createRequestContainer } from "@open-mercato/shared/lib/di/container";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import type { EntityManager } from "@mikro-orm/postgresql";
import { ImportSession } from "../../../../data/entities";

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ["airtable_import.view"] },
};

export const openApi: OpenApiRouteDoc = {
  tag: "Airtable Import",
  methods: {
    GET: { summary: "Stream import log entries via SSE" },
  },
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthFromRequest(req);
  if (!auth?.tenantId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;

  const lastSeenIndex = parseInt(req.headers.get("Last-Event-ID") ?? "-1", 10);

  const encoder = new TextEncoder();

  const container = await createRequestContainer();
  const em = container.resolve<EntityManager>("em");

  let clientConnected = true;

  const stream = new ReadableStream({
    async start(controller) {
      const POLL_INTERVAL_MS = 1_000;
      const TERMINAL = new Set(["done", "failed", "cancelled"]);
      let cursor = lastSeenIndex + 1;

      const send = (eventId: number, data: string) => {
        controller.enqueue(encoder.encode(`id: ${eventId}\ndata: ${data}\n\n`));
      };

      while (clientConnected) {
        em.clear();
        const session = await em.findOne(ImportSession, {
          id,
          tenantId: auth.tenantId,
        });

        if (!session) {
          controller.error(new Error("Not found"));
          return;
        }

        const logs = session.progressJson?.logs ?? [];

        for (let i = cursor; i < logs.length; i++) {
          send(i, JSON.stringify(logs[i]));
          cursor = i + 1;
        }

        if (TERMINAL.has(session.status)) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ level: "status", status: session.status })}\n\n`,
            ),
          );
          controller.close();
          return;
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    },
    cancel() {
      // Client disconnected — stop the polling loop on the next iteration
      clientConnected = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
