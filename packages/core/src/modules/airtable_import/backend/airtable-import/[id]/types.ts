// ─── Types ────────────────────────────────────────────────────────────────────

export type ImportSessionStatus =
  | "draft"
  | "analyzing"
  | "analyzed"
  | "ready"
  | "planning"
  | "planned"
  | "importing"
  | "done"
  | "failed"
  | "cancelled";

export type FieldMapping = {
  airtableFieldId: string;
  airtableFieldName: string;
  airtableFieldType: string;
  omFieldKey: string | null;
  omFieldType: string | null;
  isMappedToCreatedAt: boolean;
  isMappedToUpdatedAt: boolean;
  skip: boolean;
  sampleValues: unknown[];
};

export type TableMapping = {
  airtableTableId: string;
  airtableTableName: string;
  targetModule: string | null;
  targetEntitySlug: string | null;
  confidence?: number;
  skip: boolean;
  fieldMappings: FieldMapping[];
};

export type ImportMapping = {
  tables: TableMapping[];
};

export type ImportConfig = {
  importUsers: boolean;
  importAttachments: boolean;
  preserveDates: boolean;
  addAirtableIdField: boolean;
  overwriteExisting: boolean;
  userRoleMapping: Record<string, string>;
};

export type ImportProgress = {
  tables: Record<
    string,
    { total: number; done: number; failed: number; needsAttention: number }
  >;
  currentTable: string | null;
  startedAt: string;
  pass: number;
  logs: Array<{ level: string; message: string; timestamp: string }>;
};

export type ImportReport = {
  tables: Record<
    string,
    {
      imported: number;
      needsAttention: number;
      hardErrors: number;
      records: Array<{
        airtableId: string;
        omId: string | null;
        airtableUrl: string;
        omUrl: string | null;
        issue: string | null;
        issueType: string;
      }>;
    }
  >;
  completedAt: string;
  durationMs: number;
};

export type ImportPlan = {
  tables: Record<string, { records: unknown[] }>;
  totalRecords: number;
};

export type ImportSession = {
  id: string;
  status: ImportSessionStatus;
  currentStep: number;
  airtableBaseId: string;
  airtableBaseName?: string | null;
  mappingJson?: ImportMapping | null;
  configJson?: ImportConfig | null;
  planJson?: ImportPlan | null;
  progressJson?: ImportProgress | null;
  reportJson?: ImportReport | null;
  createdAt: string;
};

export type StepProps = {
  session: ImportSession;
  sessionId: string;
  onNext: () => void;
  onBack: () => void;
  reload: () => void;
  onRestart: () => void;
};

export type ImportLogEntry = {
  level: string;
  message: string;
  timestamp: string;
};