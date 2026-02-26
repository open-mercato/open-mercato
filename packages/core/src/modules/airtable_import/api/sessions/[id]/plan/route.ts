import { NextResponse } from "next/server";
import type { EntityManager } from "@mikro-orm/postgresql";
import { createRequestContainer } from "@open-mercato/shared/lib/di/container";
import { getAuthFromRequest } from "@open-mercato/shared/lib/auth/server";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { ImportSession } from "../../../../data/entities";
import { AirtableClient } from "../../../../lib/airtable-client";
import { buildPlan } from "../../../../lib/plan-builder";
import { decryptToken } from "../../../../lib/token-crypto";

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ["airtable_import.manage"] },
};

export const openApi: OpenApiRouteDoc = {
  tag: "Airtable Import",
  methods: {
    POST: { summary: "Generate import plan with pre-assigned UUIDs" },
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
  if (!session.mappingJson || !session.schemaJson) {
    return NextResponse.json(
      { error: "Uzupełnij mapowanie przed generowaniem planu" },
      { status: 422 },
    );
  }

  const client = new AirtableClient(
    decryptToken(session.airtableToken),
    session.airtableBaseId,
  );

  const activeTables = session.mappingJson.tables.filter((t) => !t.skip);
  const allRecordIds: Record<string, string[]> = {};

  for (const tableMapping of activeTables) {
    allRecordIds[tableMapping.airtableTableId] = await client.fetchAllRecordIds(
      tableMapping.airtableTableId,
    );
  }

  const plan = buildPlan(session.schemaJson, session.mappingJson, allRecordIds);

  session.planJson = plan;
  session.status = "planned";
  session.currentStep = Math.max(session.currentStep, 6);
  await em.flush();

  return NextResponse.json({
    ok: true,
    totalRecords: plan.totalRecords,
    tableCount: Object.keys(plan.tables).length,
    generatedAt: plan.generatedAt,
  });
}
