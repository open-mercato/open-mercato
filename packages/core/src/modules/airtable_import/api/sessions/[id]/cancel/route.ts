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
    POST: { summary: "Cancel a running import" },
  },
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthFromRequest(req);
  if (!auth?.tenantId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const container = await createRequestContainer();
  const em = container.resolve<EntityManager>("em");
  const session = await em.findOne(ImportSession, {
    id,
    tenantId: auth.tenantId,
  });
  if (!session)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.status !== "importing") {
    return NextResponse.json(
      { error: "Import nie jest w toku" },
      { status: 422 },
    );
  }

  session.status = "cancelled";
  await em.flush();

  return NextResponse.json({ ok: true });
}
