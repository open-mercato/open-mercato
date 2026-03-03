import { NextResponse } from "next/server";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { resolveSessionContext, isErrorResponse } from "../../../../lib/api-helpers";
import { updateMappingSchema } from "../../../../data/validators";

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ["airtable_import.view"] },
  PUT: { requireAuth: true, requireFeatures: ["airtable_import.manage"] },
};

export const openApi: OpenApiRouteDoc = {
  tag: "Airtable Import",
  methods: {
    GET: { summary: "Get session mapping" },
    PUT: {
      summary: "Save user-approved mapping",
      requestBody: {
        contentType: "application/json",
        schema: updateMappingSchema,
      },
    },
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
    mapping: session.mappingJson,
    schema: session.schemaJson,
    currentStep: session.currentStep,
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const body = await req.json().catch(() => null);
  const parsed = updateMappingSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid mapping", details: parsed.error.flatten() },
      { status: 400 },
    );

  const ctx = await resolveSessionContext(req, params);
  if (isErrorResponse(ctx)) return ctx;
  const { session, em } = ctx;

  session.mappingJson = parsed.data.mapping;
  session.currentStep = Math.max(session.currentStep, 4);
  await em.flush();

  return NextResponse.json({ ok: true });
}
