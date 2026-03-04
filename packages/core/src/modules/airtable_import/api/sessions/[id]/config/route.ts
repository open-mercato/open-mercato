import { NextResponse } from "next/server";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { resolveSessionContext, isErrorResponse } from "../../../../lib/api-helpers";
import { updateConfigSchema } from "../../../../data/validators";

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ["airtable_import.manage"] },
};

export const openApi: OpenApiRouteDoc = {
  tag: "Airtable Import",
  methods: {
    PUT: {
      summary: "Save import configuration",
      requestBody: {
        contentType: "application/json",
        schema: updateConfigSchema,
      },
    },
  },
};

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const body = await req.json().catch(() => null);
  const parsed = updateConfigSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid config" }, { status: 400 });

  const ctx = await resolveSessionContext(req, params);
  if (isErrorResponse(ctx)) return ctx;
  const { session, em } = ctx;

  session.configJson = parsed.data.config;
  session.currentStep = Math.max(session.currentStep, 5);
  await em.flush();

  return NextResponse.json({ ok: true });
}
