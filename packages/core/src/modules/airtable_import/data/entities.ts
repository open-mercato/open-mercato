import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  OptionalProps,
} from "@mikro-orm/core";

export type ImportSessionStatus =
  | "draft"
  | "analyzing"
  | "ready"
  | "planned"
  | "importing"
  | "done"
  | "failed"
  | "cancelled";

export interface AirtableFieldSchema {
  id: string;
  name: string;
  type: string;
  options?: Record<string, unknown>;
}

export interface AirtableTableSchema {
  id: string;
  name: string;
  fields: AirtableFieldSchema[];
  primaryFieldId: string;
  recordCount?: number;
  sampleRecords?: Record<string, unknown>[];
}

export interface AirtableCollaborator {
  id: string;
  email: string;
  name: string;
  permissionLevel: "owner" | "create" | "edit" | "comment" | "read";
}

export interface AirtableSchema {
  baseId: string;
  baseName: string;
  tables: AirtableTableSchema[];
  collaborators: AirtableCollaborator[];
}

export interface FieldMapping {
  airtableFieldId: string;
  airtableFieldName: string;
  airtableFieldType: string;
  omFieldKey: string | null;
  omFieldType: string | null;
  isMappedToCreatedAt: boolean;
  isMappedToUpdatedAt: boolean;
  skip: boolean;
  sampleValues: unknown[];
}

export interface TableMapping {
  airtableTableId: string;
  airtableTableName: string;
  targetModule: string | null;
  targetEntitySlug: string | null;
  confidence: number;
  skip: boolean;
  fieldMappings: FieldMapping[];
}

export interface ImportMapping {
  tables: TableMapping[];
}

export interface ImportConfig {
  importUsers: boolean;
  importAttachments: boolean;
  preserveDates: boolean;
  addAirtableIdField: boolean;
  overwriteExisting?: boolean;
  userRoleMapping: Record<string, string>;
}

export interface PlanRecord {
  airtableId: string;
  omId: string;
  originalCreatedAt: string | null;
  originalUpdatedAt: string | null;
}

export interface PlanTable {
  airtableTableId: string;
  airtableTableName: string;
  targetModule: string | null;
  targetEntitySlug: string | null;
  records: PlanRecord[];
}

export interface ImportPlan {
  tables: Record<string, PlanTable>;
  importOrder: string[];
  users: Record<string, string>;
  totalRecords: number;
  generatedAt: string;
}

export interface RecordProgress {
  status: "pending" | "done" | "failed" | "needs_attention";
  omId: string | null;
  error: string | null;
}

export interface StepMetrics {
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  throughputRps?: number;
  batchCount: number;
  failedBatches: number;
}

export interface ImportLogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  table?: string;
  message: string;
}

export interface ImportProgress {
  tables: Record<
    string,
    {
      total: number;
      done: number;
      failed: number;
      needsAttention: number;
      records: Record<string, RecordProgress>;
      metrics: StepMetrics;
    }
  >;
  currentTable: string | null;
  startedAt: string;
  pass: 1 | 2 | 3 | 4;
  logs: ImportLogEntry[];
}

export interface ReportRecord {
  airtableId: string;
  omId: string | null;
  airtableUrl: string | null;
  omUrl: string | null;
  issue: string;
  issueType: "missing_field" | "duplicate" | "hard_error";
}

export interface ImportReport {
  tables: Record<
    string,
    {
      imported: number;
      needsAttention: number;
      hardErrors: number;
      records: ReportRecord[];
    }
  >;
  users: { imported: number; failed: number };
  completedAt: string;
  durationMs: number;
}

@Entity({ tableName: "import_sessions" })
@Index({
  name: "import_sessions_tenant_org_idx",
  properties: ["tenantId", "organizationId"],
})
export class ImportSession {
  [OptionalProps]?: "createdAt" | "updatedAt" | "currentStep" | "status";

  @PrimaryKey({ type: "uuid", defaultRaw: "gen_random_uuid()" })
  id!: string;

  @Property({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Property({ name: "organization_id", type: "uuid" })
  organizationId!: string;

  @Property({ type: "text", default: "draft" })
  status!: ImportSessionStatus;

  @Property({ name: "current_step", type: "int", default: 1 })
  currentStep!: number;

  @Property({ name: "airtable_token", type: "text" })
  airtableToken!: string;

  @Property({ name: "airtable_base_id", type: "text" })
  airtableBaseId!: string;

  @Property({ name: "airtable_base_name", type: "text", nullable: true })
  airtableBaseName?: string | null;

  @Property({ name: "schema_json", type: "jsonb", nullable: true })
  schemaJson?: AirtableSchema | null;

  @Property({ name: "mapping_json", type: "jsonb", nullable: true })
  mappingJson?: ImportMapping | null;

  @Property({ name: "config_json", type: "jsonb", nullable: true })
  configJson?: ImportConfig | null;

  @Property({ name: "plan_json", type: "jsonb", nullable: true })
  planJson?: ImportPlan | null;

  @Property({ name: "progress_json", type: "jsonb", nullable: true })
  progressJson?: ImportProgress | null;

  @Property({ name: "report_json", type: "jsonb", nullable: true })
  reportJson?: ImportReport | null;

  @Property({
    name: "created_at",
    type: "timestamptz",
    onCreate: () => new Date(),
  })
  createdAt!: Date;

  @Property({
    name: "updated_at",
    type: "timestamptz",
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  updatedAt!: Date;
}
