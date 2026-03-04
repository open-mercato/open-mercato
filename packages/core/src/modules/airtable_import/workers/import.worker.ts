import type { EntityManager } from "@mikro-orm/postgresql";
import type { QueuedJob } from "@open-mercato/queue";
import { createRequestContainer } from "@open-mercato/shared/lib/di/container";
import {
  ImportSession,
  type ImportProgress,
  type ImportReport,
  type ReportRecord,
} from "../data/entities";
import { AirtableClient } from "../lib/airtable-client";
import { transformFieldValue } from "../lib/field-transformers";
import { resolveImporter } from "../lib/importers";
import { decryptToken } from "../lib/token-crypto";

// Maps targetModule to the underlying DB table name used in the preserveDates SQL patch.
// Custom entity records always land in custom_field_records (null targetModule or unknown module).
const MODULE_DB_TABLE: Record<string, string> = {
  "customers.people": "customer_people",
  "customers.companies": "customer_companies",
  "customers.deals": "customer_deals",
  "catalog.products": "catalog_products",
  "sales.orders": "sales_orders",
  "staff.members": "staff_team_members",
};

export const metadata = {
  queue: "airtable-import",
  id: "import-worker",
  concurrency: 1,
};

interface WorkerPayload {
  sessionId: string;
  tenantId: string;
  omUrl: string;
  omApiKey: string;
  isRetry?: boolean;
  retryAirtableIds?: Record<string, string[]>;
}

export default async function handler(job: QueuedJob<WorkerPayload>) {
  const { sessionId, tenantId, omUrl, omApiKey, isRetry, retryAirtableIds } =
    job.payload;

  const container = await createRequestContainer();
  const em = container.resolve<EntityManager>("em");

  const session = await em.findOne(ImportSession, { id: sessionId, tenantId });
  if (!session || !session.planJson || !session.mappingJson) return;

  const plan = session.planJson;
  const mapping = session.mappingJson;
  const config = session.configJson ?? {
    importUsers: false,
    importAttachments: false,
    preserveDates: true,
    addAirtableIdField: true,
    userRoleMapping: {},
  };

  const client = new AirtableClient(
    decryptToken(session.airtableToken),
    session.airtableBaseId,
  );

  if (!session.progressJson || !isRetry) {
    session.progressJson = {
      tables: {},
      currentTable: null,
      startedAt: new Date().toISOString(),
      pass: 1,
      logs: [],
    };
  }

  const progress = session.progressJson;
  const reportTables: ImportReport["tables"] = {};

  for (const tableId of plan.importOrder) {
    // Check for cancellation before each table using a forked EM to avoid detaching tracked entities
    const checkEm = em.fork();
    const freshSession = await checkEm.findOne(ImportSession, {
      id: sessionId,
      tenantId,
    });
    if (freshSession?.status === "cancelled") {
      return;
    }

    const planTable = plan.tables[tableId];
    if (!planTable) continue;

    const tableMapping = mapping.tables.find(
      (t) => t.airtableTableId === tableId,
    );
    if (!tableMapping || tableMapping.skip) continue;

    progress.currentTable = planTable.airtableTableName;
    progress.pass = 1;
    if (!progress.tables[tableId]) {
      progress.tables[tableId] = {
        total: planTable.records.length,
        done: 0,
        failed: 0,
        needsAttention: 0,
        records: {},
        metrics: {
          startedAt: new Date().toISOString(),
          batchCount: 0,
          failedBatches: 0,
        },
      };
    }
    // Subtract previous failed/needsAttention counters for records being retried so
    // they don't get double-counted when the new outcome is written below.
    if (isRetry && retryAirtableIds?.[tableId]) {
      for (const airtableId of retryAirtableIds[tableId]) {
        const prev = progress.tables[tableId]?.records[airtableId];
        if (prev?.status === "failed") progress.tables[tableId].failed--;
        else if (prev?.status === "needs_attention")
          progress.tables[tableId].needsAttention--;
      }
    }

    session.progressJson = { ...progress };
    await em.flush();

    const recordsToProcess =
      isRetry && retryAirtableIds?.[tableId]
        ? planTable.records.filter((r) =>
            retryAirtableIds[tableId].includes(r.airtableId),
          )
        : planTable.records.filter(
            (r) =>
              !progress.tables[tableId]?.records[r.airtableId] ||
              progress.tables[tableId].records[r.airtableId].status !== "done",
          );

    const airtableRecords = await client.fetchAllRecords(tableId);
    const recordMap = new Map(airtableRecords.map((r) => [r.id, r]));

    const reportRecords: ReportRecord[] = [];
    const importer = resolveImporter(
      planTable.targetModule ?? null,
      planTable.targetEntitySlug,
    );

    for (const planRecord of recordsToProcess) {
      const airtableRecord = recordMap.get(planRecord.airtableId);
      if (!airtableRecord) {
        progress.tables[tableId].records[planRecord.airtableId] = {
          status: "failed",
          omId: planRecord.omId,
          error: "Rekord nie znaleziony w Airtable",
        };
        progress.tables[tableId].failed++;
        continue;
      }

      if (airtableRecord.createdTime) {
        planRecord.originalCreatedAt = airtableRecord.createdTime;
      }

      const transformedFields: Record<string, unknown> = {};
      if (config.addAirtableIdField) {
        transformedFields["airtable_id"] = planRecord.airtableId;
      }

      for (const fieldMapping of tableMapping.fieldMappings) {
        if (fieldMapping.skip || !fieldMapping.omFieldKey) continue;
        if (
          fieldMapping.isMappedToCreatedAt ||
          fieldMapping.isMappedToUpdatedAt
        )
          continue;

        const rawValue = airtableRecord.fields[fieldMapping.airtableFieldName];
        const transformed = transformFieldValue(
          fieldMapping.airtableFieldType,
          rawValue,
        );
        if (transformed !== null) {
          transformedFields[fieldMapping.omFieldKey] = transformed;
        }
      }

      const result = await importer({
        omId: planRecord.omId,
        airtableId: planRecord.airtableId,
        fields: transformedFields,
        tenantId,
        organizationId: session.organizationId,
        omUrl,
        omApiKey,
        ...(planTable.targetEntitySlug != null || !planTable.targetModule
          ? {
              entitySlug:
                planTable.targetEntitySlug ??
                planTable.airtableTableName.toLowerCase().replace(/\s+/g, "_"),
            }
          : {}),
      } as Parameters<typeof importer>[0]);

      if (result.ok) {
        progress.tables[tableId].records[planRecord.airtableId] = {
          status: "done",
          omId: planRecord.omId,
          error: null,
        };
        progress.tables[tableId].done++;
      } else if (result.needsAttention) {
        progress.tables[tableId].records[planRecord.airtableId] = {
          status: "needs_attention",
          omId: planRecord.omId,
          error: result.attentionReason ?? null,
        };
        progress.tables[tableId].needsAttention++;
        reportRecords.push({
          airtableId: planRecord.airtableId,
          omId: planRecord.omId,
          airtableUrl: `https://airtable.com/${session.airtableBaseId}/${tableId}/${planRecord.airtableId}`,
          omUrl: null,
          issue: result.attentionReason ?? "Wymaga uwagi",
          issueType: "missing_field",
        });
      } else {
        progress.tables[tableId].records[planRecord.airtableId] = {
          status: "failed",
          omId: null,
          error: result.error ?? "Unknown error",
        };
        progress.tables[tableId].failed++;
        reportRecords.push({
          airtableId: planRecord.airtableId,
          omId: null,
          airtableUrl: `https://airtable.com/${session.airtableBaseId}/${tableId}/${planRecord.airtableId}`,
          omUrl: null,
          issue: result.error ?? "Unknown error",
          issueType: "hard_error",
        });
      }

      if (
        (progress.tables[tableId].done + progress.tables[tableId].failed) %
          50 ===
        0
      ) {
        session.progressJson = { ...progress };
        session.planJson = plan;
        await em.flush();
      }
    }

    reportTables[tableId] = {
      imported: progress.tables[tableId].done,
      needsAttention: progress.tables[tableId].needsAttention,
      hardErrors: progress.tables[tableId].failed,
      records: reportRecords,
    };
  }

  if (config.preserveDates) {
    const knex = em.getConnection().getKnex();
    for (const [, planTable] of Object.entries(plan.tables)) {
      const dbTable =
        MODULE_DB_TABLE[planTable.targetModule ?? ""] ?? "custom_field_records";
      for (const planRecord of planTable.records) {
        if (!planRecord.originalCreatedAt) continue;
        if (
          progress.tables[planTable.airtableTableId]?.records[
            planRecord.airtableId
          ]?.status !== "done"
        )
          continue;

        await knex
          .raw(
            `UPDATE ${dbTable} SET created_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
            [
              planRecord.originalCreatedAt,
              planRecord.originalUpdatedAt ?? planRecord.originalCreatedAt,
              planRecord.omId,
              tenantId,
            ],
          )
          .catch(() => {
            /* date restore is best-effort */
          });
      }
    }
  }

  session.status = "done";
  session.currentStep = 8;
  session.progressJson = { ...progress, currentTable: null };
  session.planJson = plan;
  session.reportJson = {
    tables: reportTables,
    users: { imported: 0, failed: 0 },
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - new Date(progress.startedAt).getTime(),
  };
  await em.flush();
}
