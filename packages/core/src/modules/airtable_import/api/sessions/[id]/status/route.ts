import { NextResponse } from "next/server";
import type { EntityManager } from "@mikro-orm/postgresql";
import { createRequestContainer } from "@open-mercato/shared/lib/di/container";
import { getAuthFromRequest } from "@open-mercato/shared/lib/auth/server";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { ImportSession } from "../../../../data/entities";

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ["airtable_import.view"] },
};

export const openApi: OpenApiRouteDoc = {
  tag: "Airtable Import",
  methods: {
    GET: { summary: "Get live import progress" },
  },
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthFromRequest(req);
  if (!auth?.tenantId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const container = await createRequestContainer();
  const session = await container
    .resolve<EntityManager>("em")
    .findOne(ImportSession, { id, tenantId: auth.tenantId });
  if (!session)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    id: session.id,
    status: session.status,
    currentStep: session.currentStep,
    airtableBaseId: session.airtableBaseId,
    airtableBaseName: session.airtableBaseName,
    mappingJson: session.mappingJson,
    configJson: session.configJson,
    planJson: session.planJson,
    progressJson: session.progressJson,
    reportJson: session.reportJson,
  });
}
