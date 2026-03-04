import { NextResponse } from "next/server";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import { resolveSessionContext, isErrorResponse } from "../../../../lib/api-helpers";
import {
  type AirtableSchema,
  type FieldMapping,
  type TableMapping,
} from "../../../../data/entities";
import { AirtableClient } from "../../../../lib/airtable-client";
import { decryptToken } from "../../../../lib/token-crypto";
import { matchTableToModule } from "../../../../lib/module-matcher";
import {
  mapAirtableFieldType,
  isRelationField,
  isSystemField,
  suggestDateMapping,
} from "../../../../lib/schema-analyzer";

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ["airtable_import.manage"] },
};

export const openApi: OpenApiRouteDoc = {
  tag: "Airtable Import",
  methods: {
    POST: { summary: "Fetch and analyze Airtable schema" },
  },
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveSessionContext(req, params);
  if (isErrorResponse(ctx)) return ctx;
  const { session, em } = ctx;

  if (session.status === "importing") {
    return NextResponse.json(
      { error: "Import in progress — cannot re-analyze schema" },
      { status: 422 },
    );
  }

  session.status = "analyzing";
  await em.flush();

  try {
    const client = new AirtableClient(
      decryptToken(session.airtableToken),
      session.airtableBaseId,
    );

    const [schemaData, collaborators, baseInfo] = await Promise.all([
      client.fetchSchema(),
      client.fetchCollaborators().catch(() => []),
      client.fetchBaseInfo().catch(() => null),
    ]);

    const tablesWithSamples = await Promise.all(
      schemaData.tables.map(async (table) => {
        const sampleRecords = await client
          .fetchSampleRecords(table.id, 5)
          .catch(() => []);
        return {
          ...table,
          sampleRecords: sampleRecords as Record<string, unknown>[],
        };
      }),
    );

    const schema: AirtableSchema = {
      baseId: session.airtableBaseId,
      baseName: baseInfo?.name ?? session.airtableBaseId,
      tables: tablesWithSamples,
      collaborators,
    };

    const tableMappings: TableMapping[] = tablesWithSamples.map((table) => {
      const match = matchTableToModule(table);
      const targetEntitySlug = match.targetModule
        ? match.targetModule
            .replace("customers.", "")
            .replace("catalog.", "")
            .replace("sales.", "")
        : `custom_${table.name.toLowerCase().replace(/\s+/g, "_")}`;

      const fieldMappings: FieldMapping[] = table.fields.map((field) => {
        const omType = mapAirtableFieldType(field.type);
        const isRelation = isRelationField(field.type);
        const isSys = isSystemField(field.type);
        const dateSuggestion =
          field.type === "date" || field.type === "dateTime"
            ? suggestDateMapping(field.name)
            : null;

        const sampleValues = (table.sampleRecords ?? [])
          .map(
            (r) =>
              (r as { fields: Record<string, unknown> }).fields?.[field.name],
          )
          .filter((v) => v !== undefined && v !== null)
          .slice(0, 5);

        return {
          airtableFieldId: field.id,
          airtableFieldName: field.name,
          airtableFieldType: field.type,
          omFieldKey:
            isRelation || isSys
              ? null
              : field.name.toLowerCase().replace(/\s+/g, "_"),
          omFieldType: isRelation || isSys ? null : omType,
          isMappedToCreatedAt: dateSuggestion === "created_at",
          isMappedToUpdatedAt: dateSuggestion === "updated_at",
          skip: isSys || isRelation,
          sampleValues,
        };
      });

      return {
        airtableTableId: table.id,
        airtableTableName: table.name,
        targetModule: match.targetModule,
        targetEntitySlug,
        confidence: match.confidence,
        skip: false,
        fieldMappings,
      };
    });

    session.schemaJson = schema;
    session.mappingJson = { tables: tableMappings };
    session.airtableBaseName = schema.baseName;
    session.status = "ready";
    session.currentStep = 3;
    await em.flush();

    return NextResponse.json({
      ok: true,
      tableCount: tablesWithSamples.length,
    });
  } catch (err) {
    session.status = "failed";
    await em.flush();
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
