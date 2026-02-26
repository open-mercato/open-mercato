import { randomUUID } from "crypto";
import type {
  ImportPlan,
  PlanTable,
  ImportMapping,
  AirtableSchema,
} from "../data/entities";

export function topologicalSort(
  tableIds: string[],
  relations: Record<string, string[]>, // tableId → [dependsOnTableId]
): string[] {
  const visited = new Set<string>();
  const result: string[] = [];
  const inProgress = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    if (inProgress.has(id)) return; // cycle — skip
    inProgress.add(id);
    for (const dep of relations[id] ?? []) {
      visit(dep);
    }
    inProgress.delete(id);
    visited.add(id);
    result.push(id);
  }

  for (const id of tableIds) visit(id);
  return result;
}

export function buildPlan(
  schema: AirtableSchema,
  mapping: ImportMapping,
  allRecordIds: Record<string, string[]>, // tableId → [airtableRecordId]
): ImportPlan {
  // Build relation graph for topological sort
  const relations: Record<string, string[]> = {};
  for (const tableMapping of mapping.tables) {
    if (tableMapping.skip) continue;
    relations[tableMapping.airtableTableId] = [];
  }

  const activeTableIds = mapping.tables
    .filter((t) => !t.skip)
    .map((t) => t.airtableTableId);

  const importOrder = topologicalSort(activeTableIds, relations);

  const tables: Record<string, PlanTable> = {};
  let totalRecords = 0;

  for (const tableMapping of mapping.tables) {
    if (tableMapping.skip) continue;

    const recordIds = allRecordIds[tableMapping.airtableTableId] ?? [];
    totalRecords += recordIds.length;

    tables[tableMapping.airtableTableId] = {
      airtableTableId: tableMapping.airtableTableId,
      airtableTableName: tableMapping.airtableTableName,
      targetModule: tableMapping.targetModule,
      targetEntitySlug: tableMapping.targetEntitySlug,
      records: recordIds.map((airtableId) => ({
        airtableId,
        omId: randomUUID(),
        originalCreatedAt: null,
        originalUpdatedAt: null,
      })),
    };
  }

  return {
    tables,
    importOrder,
    users: {},
    totalRecords,
    generatedAt: new Date().toISOString(),
  };
}
