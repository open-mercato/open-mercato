import { NextResponse } from "next/server";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { resolveSessionContext, isErrorResponse } from "../../../../lib/api-helpers";

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
  const ctx = await resolveSessionContext(req, params);
  if (isErrorResponse(ctx)) return ctx;
  const { session } = ctx;

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
