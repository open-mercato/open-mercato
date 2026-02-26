import { NextResponse } from "next/server";
import type { EntityManager } from "@mikro-orm/postgresql";
import { createRequestContainer } from "@open-mercato/shared/lib/di/container";
import { getAuthFromRequest } from "@open-mercato/shared/lib/auth/server";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { ImportSession } from "../../../../data/entities";
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
    mapping: session.mappingJson,
    schema: session.schemaJson,
    currentStep: session.currentStep,
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthFromRequest(req);
  if (!auth?.tenantId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = updateMappingSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid mapping", details: parsed.error.flatten() },
      { status: 400 },
    );

  const { id } = await params;
  const container = await createRequestContainer();
  const em = container.resolve<EntityManager>("em");
  const session = await em.findOne(ImportSession, {
    id,
    tenantId: auth.tenantId,
  });
  if (!session)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  session.mappingJson = parsed.data.mapping;
  session.currentStep = Math.max(session.currentStep, 4);
  await em.flush();

  return NextResponse.json({ ok: true });
}
