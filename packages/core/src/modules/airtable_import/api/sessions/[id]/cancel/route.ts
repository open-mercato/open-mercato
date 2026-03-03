import { NextResponse } from "next/server";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { resolveSessionContext, isErrorResponse } from "../../../../lib/api-helpers";

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
  const ctx = await resolveSessionContext(req, params);
  if (isErrorResponse(ctx)) return ctx;
  const { session, em } = ctx;
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
