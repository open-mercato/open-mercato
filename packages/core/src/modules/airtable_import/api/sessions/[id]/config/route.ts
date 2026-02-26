import { NextResponse } from "next/server";
import type { EntityManager } from "@mikro-orm/postgresql";
import { createRequestContainer } from "@open-mercato/shared/lib/di/container";
import { getAuthFromRequest } from "@open-mercato/shared/lib/auth/server";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { ImportSession } from "../../../../data/entities";
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
  const auth = await getAuthFromRequest(req);
  if (!auth?.tenantId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = updateConfigSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid config" }, { status: 400 });

  const { id } = await params;
  const container = await createRequestContainer();
  const em = container.resolve<EntityManager>("em");
  const session = await em.findOne(ImportSession, {
    id,
    tenantId: auth.tenantId,
  });
  if (!session)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  session.configJson = parsed.data.config;
  session.currentStep = Math.max(session.currentStep, 5);
  await em.flush();

  return NextResponse.json({ ok: true });
}
