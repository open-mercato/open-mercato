import { NextResponse } from "next/server";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { resolveSessionContext, isErrorResponse } from "../../../../lib/api-helpers";
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
  const ctx = await resolveSessionContext(req, params);
  if (isErrorResponse(ctx)) return ctx;
  const { session, em } = ctx;
  if (!session.mappingJson || !session.schemaJson) {
    return NextResponse.json(
      { error: "Fill in the mapping before generating the plan" },
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
