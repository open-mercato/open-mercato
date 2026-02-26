import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthFromRequest } from "@open-mercato/shared/lib/auth/server";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { AirtableClient } from "../../lib/airtable-client";

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ["airtable_import.manage"] },
};

const bodySchema = z.object({
  airtableToken: z.string().min(1),
  airtableBaseId: z.string().min(1),
});

const responseSchema = z.object({
  ok: z.boolean(),
  tableCount: z.number().optional(),
  collaboratorCount: z.number().optional(),
  error: z.string().optional(),
});

export const openApi: OpenApiRouteDoc = {
  tag: "Airtable Import",
  methods: {
    POST: {
      summary: "Test Airtable connection",
      requestBody: { contentType: "application/json", schema: bodySchema },
      responses: [{ status: 200, schema: responseSchema }],
    },
  },
};

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth?.tenantId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Nieprawidłowe dane wejściowe" },
      { status: 400 },
    );
  }

  const { airtableToken, airtableBaseId } = parsed.data;

  try {
    const client = new AirtableClient(airtableToken, airtableBaseId);
    const schema = await client.fetchSchema();
    const collaborators = await client.fetchCollaborators().catch(() => []);

    return NextResponse.json({
      ok: true,
      tableCount: schema.tables.length,
      collaboratorCount: collaborators.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Nieznany błąd";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
