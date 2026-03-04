import { NextResponse } from "next/server";
import type { EntityManager } from "@mikro-orm/postgresql";
import { createRequestContainer } from "@open-mercato/shared/lib/di/container";
import { getAuthFromRequest } from "@open-mercato/shared/lib/auth/server";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { ImportSession } from "../../data/entities";
import { createSessionSchema } from "../../data/validators";
import { encryptToken } from "../../lib/token-crypto";

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ["airtable_import.view"] },
  POST: { requireAuth: true, requireFeatures: ["airtable_import.manage"] },
};

export const openApi: OpenApiRouteDoc = {
  tag: "Airtable Import",
  methods: {
    GET: { summary: "List import sessions" },
    POST: {
      summary: "Create import session",
      requestBody: {
        contentType: "application/json",
        schema: createSessionSchema,
      },
    },
  },
};

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth?.tenantId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const container = await createRequestContainer();
  const em = container.resolve<EntityManager>("em");

  const sessions = await em.find(
    ImportSession,
    {
      tenantId: auth.tenantId,
      ...(auth.orgId ? { organizationId: auth.orgId } : {}),
    },
    { orderBy: { createdAt: "desc" }, limit: 50 },
  );

  return NextResponse.json({
    items: sessions.map((s) => {
      const tableValues = Object.values(s.progressJson?.tables ?? {});
      const recordsTotal = tableValues.reduce((sum, t) => sum + t.total, 0);
      const recordsDone = tableValues.reduce((sum, t) => sum + t.done, 0);
      const recordsFailed = tableValues.reduce((sum, t) => sum + t.failed, 0);
      const recordsAttention = tableValues.reduce(
        (sum, t) => sum + t.needsAttention,
        0,
      );
      return {
        id: s.id,
        status: s.status,
        currentStep: s.currentStep,
        airtableBaseId: s.airtableBaseId,
        airtableBaseName: s.airtableBaseName,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        recordsTotal,
        recordsDone,
        recordsFailed,
        recordsAttention,
      };
    }),
  });
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth?.tenantId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const container = await createRequestContainer();
  const em = container.resolve<EntityManager>("em");

  const session = em.create(ImportSession, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? auth.tenantId,
    airtableToken: encryptToken(parsed.data.airtableToken),
    airtableBaseId: parsed.data.airtableBaseId,
    status: "draft",
    currentStep: 1,
  });

  await em.flush();

  return NextResponse.json({ id: session.id }, { status: 201 });
}
