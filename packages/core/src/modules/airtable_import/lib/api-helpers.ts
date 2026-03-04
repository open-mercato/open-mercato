import { NextResponse } from "next/server";
import type { EntityManager } from "@mikro-orm/postgresql";
import { createRequestContainer } from "@open-mercato/shared/lib/di/container";
import { getAuthFromRequest } from "@open-mercato/shared/lib/auth/server";
import { ImportSession } from "../data/entities";

export interface SessionContext {
  auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>> & {
    tenantId: string;
  };
  session: ImportSession;
  em: EntityManager;
}

export async function resolveSessionContext(
  req: Request,
  params: Promise<{ id: string }>,
): Promise<SessionContext | NextResponse> {
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

  return { auth: auth as SessionContext["auth"], session, em };
}

export function isErrorResponse(
  v: SessionContext | NextResponse,
): v is NextResponse {
  return v instanceof NextResponse;
}
