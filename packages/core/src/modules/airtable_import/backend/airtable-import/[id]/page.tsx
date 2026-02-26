"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Page, PageBody } from "@open-mercato/ui/backend/Page";
import { Button } from "@open-mercato/ui/primitives/button";
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall";
import { flash } from "@open-mercato/ui/backend/FlashMessages";
import { LoadingMessage, ErrorMessage } from "@open-mercato/ui/backend/detail";

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportSessionStatus =
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

type FieldMapping = {
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

type TableMapping = {
  airtableTableId: string;
  airtableTableName: string;
  targetModule: string | null;
  targetEntitySlug: string | null;
  confidence?: number;
  skip: boolean;
  fieldMappings: FieldMapping[];
};

type ImportMapping = {
  tables: TableMapping[];
};

type ImportConfig = {
  importUsers: boolean;
  importAttachments: boolean;
  preserveDates: boolean;
  addAirtableIdField: boolean;
  overwriteExisting: boolean;
  userRoleMapping: Record<string, string>;
};

type ImportProgress = {
  tables: Record<
    string,
    { total: number; done: number; failed: number; needsAttention: number }
  >;
  currentTable: string | null;
  startedAt: string;
  pass: number;
  logs: Array<{ level: string; message: string; timestamp: string }>;
};

type ImportReport = {
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

type ImportPlan = {
  tables: Record<string, { records: unknown[] }>;
  totalRecords: number;
};

type ImportSession = {
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MODULE_OPTIONS = [
  { value: "customers.people", label: "Kontakty i osoby" },
  { value: "customers.companies", label: "Firmy i organizacje" },
  { value: "customers.deals", label: "Szanse sprzedażowe" },
  { value: "catalog.products", label: "Produkty" },
  { value: "catalog.categories", label: "Kategorie produktów" },
  { value: "sales.orders", label: "Zamówienia" },
  { value: "sales.invoices", label: "Faktury" },
  { value: "sales.quotes", label: "Oferty / wyceny" },
  { value: "staff.members", label: "Pracownicy (dane kadrowe)" },
  { value: "planner.tasks", label: "Zadania" },
  { value: "__custom__", label: "+ Utwórz nową encję Custom" },
];

const STEP_LABELS = [
  "Połączenie",
  "Analiza",
  "Mapowanie tabel",
  "Mapowanie pól",
  "Opcje",
  "Plan",
  "Import",
  "Raport",
];

// ─── Step props ───────────────────────────────────────────────────────────────

type StepProps = {
  session: ImportSession;
  sessionId: string;
  onNext: () => void;
  onBack: () => void;
  reload: () => void;
  onRestart: () => void;
};

// ─── Step 1: Connect ──────────────────────────────────────────────────────────

function StepConnect({ session, onNext, onRestart: _ }: StepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Krok 1: Połączenie z Airtable</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sprawdź dane połączenia z bazą Airtable i przejdź do kolejnego kroku.
        </p>
      </div>
      <div className="rounded-lg border p-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <span className="font-medium text-muted-foreground">ID bazy</span>
          <span className="font-mono">{session.airtableBaseId}</span>
          <span className="font-medium text-muted-foreground">Nazwa bazy</span>
          <span>{session.airtableBaseName ?? "(nieznana)"}</span>
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={onNext}>
          Dalej →
        </Button>
      </div>
    </div>
  );
}

// ─── Step 2: Analyze ──────────────────────────────────────────────────────────

function StepAnalyze({
  session,
  sessionId,
  onNext,
  onBack,
  reload,
}: StepProps) {
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    const res = await apiCall(
      `/api/airtable_import/sessions/${sessionId}/schema`,
      { method: "POST" },
    );
    setIsAnalyzing(false);
    if (res.ok) {
      flash("Analiza zakończona pomyślnie", "success");
      reload();
    } else {
      const err = await res.response.text().catch(() => "Błąd");
      flash(`Błąd analizy: ${err}`, "error");
    }
  };

  const isAnalyzed = session.status !== "draft" && session.mappingJson != null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Krok 2: Analiza bazy</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          System pobierze schemat tabel i automatycznie dopasuje je do modułów
          Open Mercato.
        </p>
      </div>
      {isAnalyzed && session.mappingJson && (
        <div className="rounded-lg border p-4">
          <p className="mb-2 text-sm font-medium">
            Przeanalizowano {session.mappingJson.tables.length} tabel:
          </p>
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            {session.mappingJson.tables.map((t) => (
              <li key={t.airtableTableId}>
                <span className="font-medium text-foreground">
                  {t.airtableTableName}
                </span>
                {t.targetModule
                  ? ` → ${t.targetModule}`
                  : " → (niezdopasowane)"}
                {t.confidence != null && (
                  <span
                    className={`ml-1 text-xs ${
                      t.confidence >= 70
                        ? "text-green-600"
                        : t.confidence >= 40
                          ? "text-yellow-600"
                          : "text-gray-400"
                    }`}
                  >
                    ({t.confidence} pkt)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          ← Wstecz
        </Button>
        <div className="flex gap-2">
          {!isAnalyzed && (
            <Button
              type="button"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? "Analizowanie…" : "Analizuj bazę"}
            </Button>
          )}
          {isAnalyzed && (
            <Button type="button" onClick={onNext}>
              Dalej →
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: Module Mapping ───────────────────────────────────────────────────

function StepModuleMapping({
  session,
  sessionId,
  onNext,
  onBack,
  reload,
}: StepProps) {
  const [mapping, setMapping] = React.useState<ImportMapping>(
    session.mappingJson ?? { tables: [] },
  );
  const [isSaving, setIsSaving] = React.useState(false);

  const handleModuleChange = (tableId: string, value: string) => {
    setMapping((prev) => ({
      ...prev,
      tables: prev.tables.map((t) =>
        t.airtableTableId === tableId
          ? {
              ...t,
              targetModule: value === "__custom__" ? null : value,
              targetEntitySlug:
                value === "__custom__"
                  ? t.airtableTableName.toLowerCase().replace(/\s+/g, "_")
                  : null,
            }
          : t,
      ),
    }));
  };

  const handleSkipChange = (tableId: string, skip: boolean) => {
    setMapping((prev) => ({
      ...prev,
      tables: prev.tables.map((t) =>
        t.airtableTableId === tableId ? { ...t, skip } : t,
      ),
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    const res = await apiCall(
      `/api/airtable_import/sessions/${sessionId}/mapping`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping }),
      },
    );
    setIsSaving(false);
    if (res.ok) {
      await reload();
      onNext();
    } else {
      const errData = res.result as { error?: string } | null;
      flash(errData?.error ?? "Błąd zapisu mapowania", "error");
    }
  };

  const getConfidenceBadge = (confidence: number | undefined) => {
    if (confidence == null) return null;
    if (confidence >= 70)
      return (
        <span className="text-xs text-green-600">
          ✅ Pewne ({confidence} pkt)
        </span>
      );
    if (confidence >= 40)
      return (
        <span className="text-xs text-yellow-600">
          ⚡ Prawdopodobne ({confidence} pkt)
        </span>
      );
    return (
      <span className="text-xs text-gray-400">
        ❓ Nieznane ({confidence} pkt)
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Krok 3: Mapowanie tabel</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Przypisz każdą tabelę Airtable do odpowiedniego modułu Open Mercato
          lub utwórz nową encję.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {mapping.tables.map((table) => {
          const currentValue =
            table.targetModule ??
            (table.targetEntitySlug != null ? "__custom__" : "__custom__");
          return (
            <div
              key={table.airtableTableId}
              className={`rounded-lg border p-4 ${table.skip ? "opacity-50" : ""}`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{table.airtableTableName}</p>
                  <p className="text-xs text-muted-foreground">
                    {table.fieldMappings.length} pól
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {getConfidenceBadge(table.confidence)}
                  <select
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    value={currentValue}
                    onChange={(e) =>
                      handleModuleChange(table.airtableTableId, e.target.value)
                    }
                    disabled={table.skip}
                  >
                    {MODULE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={table.skip}
                      onChange={(e) =>
                        handleSkipChange(
                          table.airtableTableId,
                          e.target.checked,
                        )
                      }
                    />
                    Pomiń
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          ← Wstecz
        </Button>
        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Zapisywanie…" : "Dalej →"}
        </Button>
      </div>
    </div>
  );
}

// ─── Step 4: Field Mapping ────────────────────────────────────────────────────

function StepFieldMapping({
  session,
  sessionId,
  onNext,
  onBack,
  reload,
}: StepProps) {
  const [mapping, setMapping] = React.useState<ImportMapping>(
    session.mappingJson ?? { tables: [] },
  );
  const [isSaving, setIsSaving] = React.useState(false);
  const [expandedTable, setExpandedTable] = React.useState<string | null>(
    mapping.tables[0]?.airtableTableId ?? null,
  );

  const handleFieldKeyChange = (
    tableId: string,
    fieldId: string,
    omFieldKey: string,
  ) => {
    setMapping((prev) => ({
      ...prev,
      tables: prev.tables.map((t) =>
        t.airtableTableId === tableId
          ? {
              ...t,
              fieldMappings: t.fieldMappings.map((f) =>
                f.airtableFieldId === fieldId
                  ? { ...f, omFieldKey: omFieldKey || null }
                  : f,
              ),
            }
          : t,
      ),
    }));
  };

  const handleFieldSkip = (tableId: string, fieldId: string, skip: boolean) => {
    setMapping((prev) => ({
      ...prev,
      tables: prev.tables.map((t) =>
        t.airtableTableId === tableId
          ? {
              ...t,
              fieldMappings: t.fieldMappings.map((f) =>
                f.airtableFieldId === fieldId ? { ...f, skip } : f,
              ),
            }
          : t,
      ),
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    const res = await apiCall(
      `/api/airtable_import/sessions/${sessionId}/mapping`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping }),
      },
    );
    setIsSaving(false);
    if (res.ok) {
      await reload();
      onNext();
    } else {
      flash("Błąd zapisu mapowania pól", "error");
    }
  };

  const activeTables = mapping.tables.filter((t) => !t.skip);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Krok 4: Mapowanie pól</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Przeglądaj pola każdej tabeli i dostosuj mapowanie do docelowych pól
          Open Mercato.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {activeTables.map((table) => {
          const isExpanded = expandedTable === table.airtableTableId;
          return (
            <div key={table.airtableTableId} className="rounded-lg border">
              <Button
                type="button"
                variant="ghost"
                className="flex h-auto w-full items-center justify-between rounded-none px-4 py-3 text-left text-sm font-medium hover:bg-muted/50 hover:bg-opacity-50"
                onClick={() =>
                  setExpandedTable(isExpanded ? null : table.airtableTableId)
                }
              >
                <span>
                  {table.airtableTableName}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({table.fieldMappings.filter((f) => !f.skip).length}{" "}
                    aktywnych pól)
                  </span>
                </span>
                <span>{isExpanded ? "▲" : "▼"}</span>
              </Button>
              {isExpanded && (
                <div className="border-t">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className="w-[22%] px-4 py-2 text-left font-medium">
                          Pole Airtable
                        </th>
                        <th className="w-[12%] px-4 py-2 text-left font-medium">
                          Typ
                        </th>
                        <th className="w-[20%] px-4 py-2 text-left font-medium">
                          Przykłady
                        </th>
                        <th className="w-[38%] px-4 py-2 text-left font-medium">
                          Klucz OM
                        </th>
                        <th className="w-[8%] px-4 py-2 text-center font-medium">
                          Pomiń
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.fieldMappings.map((field) => (
                        <tr
                          key={field.airtableFieldId}
                          className={`border-t ${field.skip ? "opacity-40" : ""}`}
                        >
                          <td className="px-4 py-2 font-medium">
                            {field.airtableFieldName}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {field.airtableFieldType}
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            {field.sampleValues
                              .slice(0, 2)
                              .map(String)
                              .join(", ")}
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                              value={field.omFieldKey ?? ""}
                              onChange={(e) =>
                                handleFieldKeyChange(
                                  table.airtableTableId,
                                  field.airtableFieldId,
                                  e.target.value,
                                )
                              }
                              disabled={field.skip}
                            />
                          </td>
                          <td className="px-4 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={field.skip}
                              onChange={(e) =>
                                handleFieldSkip(
                                  table.airtableTableId,
                                  field.airtableFieldId,
                                  e.target.checked,
                                )
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          ← Wstecz
        </Button>
        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Zapisywanie…" : "Dalej →"}
        </Button>
      </div>
    </div>
  );
}

// ─── Step 5: Options ──────────────────────────────────────────────────────────

function StepOptions({
  session,
  sessionId,
  onNext,
  onBack,
  reload,
}: StepProps) {
  const defaults: ImportConfig = {
    importUsers: false,
    importAttachments: false,
    preserveDates: true,
    addAirtableIdField: true,
    overwriteExisting: false,
    userRoleMapping: {},
  };
  const [config, setConfig] = React.useState<ImportConfig>({
    ...defaults,
    ...(session.configJson ?? {}),
  });
  const [isSaving, setIsSaving] = React.useState(false);

  const toggle = (key: keyof ImportConfig) => {
    if (typeof config[key] !== "boolean") return;
    setConfig((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    const res = await apiCall(
      `/api/airtable_import/sessions/${sessionId}/config`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      },
    );
    setIsSaving(false);
    if (res.ok) {
      await reload();
      onNext();
    } else {
      flash("Błąd zapisu opcji", "error");
    }
  };

  const options: Array<{
    key: keyof ImportConfig;
    label: string;
    description: string;
  }> = [
    {
      key: "preserveDates",
      label: "Zachowaj daty utworzenia",
      description: "Ustawi created_at rekordów na oryginalne daty z Airtable",
    },
    {
      key: "addAirtableIdField",
      label: "Dodaj pole airtable_id",
      description:
        "Doda pole z oryginalnym ID rekordu Airtable do każdego importowanego rekordu",
    },
    {
      key: "importAttachments",
      label: "Importuj załączniki",
      description:
        "Pobierze i dołączy pliki załączników (może wydłużyć czas importu)",
    },
    {
      key: "overwriteExisting",
      label: "Nadpisz już zaimportowane rekordy",
      description:
        "Przy ponownym imporcie zaktualizuje rekordy które zostały wcześniej zaimportowane. Domyślnie: pomija już zaimportowane.",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Krok 5: Opcje importu</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Skonfiguruj dodatkowe opcje importu.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {options.map((opt) => (
          <label
            key={opt.key}
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-4"
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={config[opt.key] as boolean}
              onChange={() => toggle(opt.key)}
            />
            <div>
              <p className="font-medium">{opt.label}</p>
              <p className="text-sm text-muted-foreground">{opt.description}</p>
            </div>
          </label>
        ))}
      </div>
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          ← Wstecz
        </Button>
        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Zapisywanie…" : "Dalej →"}
        </Button>
      </div>
    </div>
  );
}

// ─── Step 6: Plan ─────────────────────────────────────────────────────────────

function StepPlan({ session, sessionId, onNext, onBack, reload }: StepProps) {
  const [isPlanning, setIsPlanning] = React.useState(false);

  const handlePlan = async () => {
    setIsPlanning(true);
    const res = await apiCall(
      `/api/airtable_import/sessions/${sessionId}/plan`,
      { method: "POST" },
    );
    setIsPlanning(false);
    if (res.ok) {
      flash("Plan importu wygenerowany", "success");
      reload();
    } else {
      flash("Błąd generowania planu", "error");
    }
  };

  const hasPlan = session.planJson != null;
  const tables = session.mappingJson?.tables.filter((t) => !t.skip) ?? [];
  const allTablesHaveCounts = tables.every(
    (t) => session.planJson?.tables[t.airtableTableId] != null,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Krok 6: Plan importu</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          System wygeneruje unikalny plan z wstępnie przypisanymi
          identyfikatorami dla każdego rekordu. Import będzie idempotentny —
          możesz go wznowić po przerwaniu.
        </p>
      </div>
      <div className="rounded-lg border p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="pb-2 text-left font-medium">Tabela</th>
              <th className="pb-2 text-left font-medium">Docelowy moduł</th>
              <th className="pb-2 text-right font-medium">Rekordy</th>
            </tr>
          </thead>
          <tbody>
            {tables.map((t) => {
              const recordCount =
                session.planJson?.tables[t.airtableTableId]?.records.length;
              return (
                <tr
                  key={t.airtableTableId}
                  className="border-b last:border-b-0"
                >
                  <td className="py-2">{t.airtableTableName}</td>
                  <td className="py-2 text-muted-foreground">
                    {t.targetModule ??
                      (t.targetEntitySlug
                        ? `Custom: ${t.targetEntitySlug}`
                        : "Custom")}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {recordCount != null ? recordCount : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          ← Wstecz
        </Button>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handlePlan}
            disabled={isPlanning}
          >
            {isPlanning
              ? "Generowanie planu…"
              : hasPlan
                ? "Regeneruj plan"
                : "Generuj plan i zatwierdź"}
          </Button>
          {hasPlan && allTablesHaveCounts && (
            <Button type="button" onClick={onNext}>
              Dalej →
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 7: Execute ──────────────────────────────────────────────────────────

type ImportLogEntry = {
  level: string;
  message: string;
  timestamp: string;
};

function StepExecute({
  session,
  sessionId,
  onNext,
  onRestart,
  reload,
}: Omit<StepProps, "onBack">) {
  const [isStarting, setIsStarting] = React.useState(false);
  const [isCancelling, setIsCancelling] = React.useState(false);
  const [logs, setLogs] = React.useState<ImportLogEntry[]>([]);
  const logsEndRef = React.useRef<HTMLDivElement>(null);
  const isImporting = session.status === "importing";

  // Track if import was ever running during this component mount
  const wasImportingRef = React.useRef(isImporting);
  React.useEffect(() => {
    if (isImporting) wasImportingRef.current = true;
  }, [isImporting]);

  // Auto-advance to report when import finishes
  React.useEffect(() => {
    if (
      wasImportingRef.current &&
      (session.status === "done" || session.status === "failed")
    ) {
      onNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status]);

  // Auto-poll session data every 2s during import to update progress bar
  React.useEffect(() => {
    if (!isImporting) return;
    const interval = setInterval(() => reload(), 2000);
    return () => clearInterval(interval);
  }, [isImporting, reload]);

  // SSE connection for live logs and terminal status
  React.useEffect(() => {
    if (!isImporting) return;

    const source = new EventSource(
      `/api/airtable_import/sessions/${sessionId}/logs`,
    );

    source.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data as string) as ImportLogEntry;
        if (entry.level === "status") {
          const statusData = entry as unknown as { status: string };
          if (
            statusData.status === "done" ||
            statusData.status === "failed" ||
            statusData.status === "cancelled"
          ) {
            source.close();
            reload();
          }
        } else {
          setLogs((prev) => [...prev.slice(-200), entry]);
        }
      } catch {
        // ignore parse errors
      }
    };

    source.onerror = () => source.close();

    return () => source.close();
  }, [isImporting, sessionId, reload]);

  // Scroll logs to bottom
  React.useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleStart = async () => {
    setIsStarting(true);
    const res = await apiCall(
      `/api/airtable_import/sessions/${sessionId}/execute`,
      { method: "POST" },
    );
    setIsStarting(false);
    if (!res.ok) {
      flash("Błąd uruchomienia importu", "error");
      return;
    }
    wasImportingRef.current = true;
    reload();
  };

  const handleCancel = async () => {
    setIsCancelling(true);
    const res = await apiCall(
      `/api/airtable_import/sessions/${sessionId}/cancel`,
      { method: "POST" },
    );
    setIsCancelling(false);
    if (!res.ok) {
      flash("Nie udało się anulować importu", "error");
      return;
    }
    flash("Import anulowany", "info");
    reload();
  };

  const progress = session.progressJson;
  const tables = progress?.tables ?? {};
  const tableIds = Object.keys(tables);
  const totalDone = tableIds.reduce(
    (s, k) =>
      s +
      (tables[k]?.done ?? 0) +
      (tables[k]?.failed ?? 0) +
      (tables[k]?.needsAttention ?? 0),
    0,
  );
  const totalRecords = tableIds.reduce(
    (s, k) => s + (tables[k]?.total ?? 0),
    0,
  );
  const progressPct =
    totalRecords > 0 ? Math.round((totalDone / totalRecords) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Krok 7: Import</h2>
        {!isImporting &&
          session.status !== "importing" &&
          session.status !== "cancelled" && (
            <p className="mt-1 text-sm text-muted-foreground">
              Kliknij &quot;Uruchom import&quot; aby rozpocząć. Możesz zamknąć
              tę stronę — import działa w tle.
            </p>
          )}
        {session.status === "cancelled" && (
          <p className="mt-1 text-sm text-yellow-600">
            Import został anulowany.
          </p>
        )}
      </div>

      {totalRecords > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>
              {progress?.currentTable ? (
                <span>
                  Przetwarzam: <strong>{progress.currentTable}</strong>
                </span>
              ) : (
                "Postęp"
              )}
            </span>
            <span className="font-medium tabular-nums">
              {totalDone} / {totalRecords} ({progressPct}%)
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground">
            {tableIds.map((tid) => {
              const t = tables[tid];
              return (
                <span key={tid}>
                  {tid}: ✓{t.done}{" "}
                  {t.needsAttention > 0 && `⚠${t.needsAttention}`}{" "}
                  {t.failed > 0 && `✗${t.failed}`}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs">
          {logs.map((log, i) => (
            <div
              key={i}
              className={
                log.level === "error"
                  ? "text-red-600"
                  : log.level === "warn"
                    ? "text-yellow-600"
                    : "text-muted-foreground"
              }
            >
              [{new Date(log.timestamp).toLocaleTimeString()}] {log.message}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      <div className="flex items-center justify-between">
        {isImporting ? (
          <>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Import w toku…
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isCancelling}
            >
              {isCancelling ? "Anulowanie…" : "Anuluj import"}
            </Button>
          </>
        ) : (
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" onClick={onRestart}>
              ← Uruchom od początku
            </Button>
            <Button type="button" onClick={handleStart} disabled={isStarting}>
              {isStarting
                ? "Uruchamianie…"
                : session.status === "done"
                  ? "Uruchom ponownie"
                  : "Uruchom import"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 8: Report ───────────────────────────────────────────────────────────

function StepReport({
  session,
  sessionId,
  reload,
  onRestart,
}: Pick<StepProps, "session" | "sessionId" | "reload" | "onRestart">) {
  const [isRetrying, setIsRetrying] = React.useState(false);
  const report = session.reportJson;

  const handleRetry = async () => {
    setIsRetrying(true);
    const res = await apiCall(
      `/api/airtable_import/sessions/${sessionId}/retry`,
      { method: "POST" },
    );
    setIsRetrying(false);
    if (res.ok) {
      flash("Ponowiono nieudane rekordy", "success");
      reload();
    } else {
      flash("Błąd ponowienia importu", "error");
    }
  };

  if (!report) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Krok 8: Raport</h2>
        <p className="text-sm text-muted-foreground">Raport niedostępny.</p>
      </div>
    );
  }

  const tables = Object.entries(report.tables);
  const totalImported = tables.reduce((s, [, t]) => s + t.imported, 0);
  const totalErrors = tables.reduce((s, [, t]) => s + t.hardErrors, 0);
  const totalAttention = tables.reduce((s, [, t]) => s + t.needsAttention, 0);
  const hasErrors = totalErrors > 0 || totalAttention > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Krok 8: Raport importu</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Import zakończony{" "}
          {new Date(report.completedAt).toLocaleString("pl-PL")}. Czas trwania:{" "}
          {Math.round(report.durationMs / 1000)}s.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{totalImported}</p>
          <p className="text-xs text-muted-foreground">Zaimportowanych</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold text-yellow-600">{totalAttention}</p>
          <p className="text-xs text-muted-foreground">Wymaga uwagi</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold text-red-600">{totalErrors}</p>
          <p className="text-xs text-muted-foreground">Błędy</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {tables.map(([tableId, tableReport]) => (
          <div key={tableId} className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">
                {session.mappingJson?.tables.find(
                  (t) => t.airtableTableId === tableId,
                )?.airtableTableName ?? tableId}
              </span>
              <div className="flex gap-3 text-xs">
                <span className="text-green-600">✓ {tableReport.imported}</span>
                {tableReport.needsAttention > 0 && (
                  <span className="text-yellow-600">
                    ⚠ {tableReport.needsAttention}
                  </span>
                )}
                {tableReport.hardErrors > 0 && (
                  <span className="text-red-600">
                    ✗ {tableReport.hardErrors}
                  </span>
                )}
              </div>
            </div>
            {tableReport.records
              .filter((r) => r.issueType === "missing_field")
              .slice(0, 10)
              .map((r) => (
                <div
                  key={r.airtableId}
                  className="mt-2 text-xs text-yellow-700"
                >
                  <a
                    href={r.airtableUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {r.airtableId}
                  </a>
                  : {r.issue}
                </div>
              ))}
            {tableReport.records
              .filter((r) => r.issueType === "hard_error")
              .slice(0, 5)
              .map((r) => (
                <div key={r.airtableId} className="mt-2 text-xs text-red-600">
                  <a
                    href={r.airtableUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {r.airtableId}
                  </a>
                  : {r.issue}
                </div>
              ))}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        {hasErrors && (
          <Button
            type="button"
            variant="outline"
            onClick={handleRetry}
            disabled={isRetrying}
          >
            {isRetrying ? "Ponawiam…" : "Ponów nieudane"}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onRestart}>
          Uruchom ponownie
        </Button>
      </div>
    </div>
  );
}

// ─── Rerun Dialog ─────────────────────────────────────────────────────────────

function RerunDialog({
  onConfirm,
  onClose,
}: {
  onConfirm: (preserveDone: boolean) => void;
  onClose: () => void;
}) {
  const [preserveDone, setPreserveDone] = React.useState(true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg">
        <h3 className="font-semibold">Uruchom ponownie</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Jak postąpić z już zaimportowanymi rekordami?
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/30">
            <input
              type="radio"
              className="mt-0.5"
              checked={preserveDone}
              onChange={() => setPreserveDone(true)}
            />
            <div>
              <p className="text-sm font-medium">Pomiń już zaimportowane</p>
              <p className="text-xs text-muted-foreground">
                Tylko nowe rekordy i błędy — szybciej
              </p>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/30">
            <input
              type="radio"
              className="mt-0.5"
              checked={!preserveDone}
              onChange={() => setPreserveDone(false)}
            />
            <div>
              <p className="text-sm font-medium">Nadpisz wszystkie</p>
              <p className="text-xs text-muted-foreground">
                Pełny re-import, aktualizuje istniejące rekordy
              </p>
            </div>
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button type="button" onClick={() => onConfirm(preserveDone)}>
            Uruchom
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="mb-6 flex items-center gap-1">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1;
        const isDone = step < current;
        const isCurrent = step === current;
        return (
          <React.Fragment key={step}>
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                isDone
                  ? "bg-primary text-primary-foreground"
                  : isCurrent
                    ? "border-2 border-primary text-primary"
                    : "border border-muted-foreground/30 text-muted-foreground"
              }`}
            >
              {isDone ? "✓" : step}
            </div>
            {step < total && (
              <div
                className={`h-px flex-1 ${isDone ? "bg-primary" : "bg-muted-foreground/20"}`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Main Wizard Page ─────────────────────────────────────────────────────────

export default function WizardPage({ params }: { params?: { id?: string } }) {
  const sessionId = params?.id;
  const router = useRouter();

  const [session, setSession] = React.useState<ImportSession | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const loadSession = React.useCallback(async () => {
    const res = await apiCall(
      `/api/airtable_import/sessions/${sessionId}/status`,
    );
    if (res.ok) {
      const data = res.result as unknown as ImportSession;
      setSession(data);
      setIsLoading(false);
    } else {
      setError("Nie udało się załadować sesji");
      setIsLoading(false);
    }
  }, [sessionId]);

  React.useEffect(() => {
    loadSession();
  }, [loadSession]);

  // Local step state for navigation (server step is source of truth on load/reload)
  const [localStep, setLocalStep] = React.useState<number | null>(null);
  const currentStep = localStep ?? session?.currentStep ?? 1;

  const handleNext = React.useCallback(() => {
    setLocalStep((s) => Math.min(8, (s ?? session?.currentStep ?? 1) + 1));
  }, [session?.currentStep]);

  const handleBack = React.useCallback(() => {
    loadSession().finally(() => {
      setLocalStep((s) => Math.max(1, (s ?? session?.currentStep ?? 1) - 1));
    });
  }, [session?.currentStep, loadSession]);

  // After a reload, sync local step with server step (unless user manually navigated)
  React.useEffect(() => {
    if (session && localStep === null) {
      setLocalStep(session.currentStep);
    }
  }, [session, localStep]);

  // If server step drops below local step (e.g. re-run from report resets to step 7), follow it
  React.useEffect(() => {
    if (session && localStep !== null && session.currentStep < localStep) {
      setLocalStep(session.currentStep);
    }
  }, [session, localStep]);

  const handleReloadAndAdvance = React.useCallback(async () => {
    await loadSession();
    setLocalStep((s) => Math.min(8, (s ?? session?.currentStep ?? 1) + 1));
  }, [loadSession, session?.currentStep]);

  const handleRestart = React.useCallback(() => {
    setLocalStep(1);
  }, []);

  const stepProps: StepProps = {
    session: session!,
    sessionId: sessionId ?? "",
    onNext: handleNext,
    onBack: handleBack,
    reload: loadSession,
    onRestart: handleRestart,
  };

  if (isLoading) return <LoadingMessage label="Ładowanie sesji…" />;
  if (error || !session)
    return <ErrorMessage label={error ?? "Sesja nie istnieje"} />;

  return (
    <Page>
      <PageBody>
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-auto p-0 text-sm text-muted-foreground hover:text-foreground hover:bg-transparent"
              onClick={() => router.push("/backend/airtable-import")}
            >
              ← Lista importów
            </Button>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm font-medium">
              {session.airtableBaseName ?? session.airtableBaseId}
            </span>
          </div>

          <StepIndicator current={currentStep} total={8} />

          <p className="mb-6 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {STEP_LABELS[currentStep - 1]}
          </p>

          {currentStep === 1 && <StepConnect {...stepProps} />}
          {currentStep === 2 && <StepAnalyze {...stepProps} />}
          {currentStep === 3 && <StepModuleMapping {...stepProps} />}
          {currentStep === 4 && <StepFieldMapping {...stepProps} />}
          {currentStep === 5 && <StepOptions {...stepProps} />}
          {currentStep === 6 && <StepPlan {...stepProps} />}
          {currentStep === 7 && (
            <StepExecute
              session={session}
              sessionId={sessionId ?? ""}
              onNext={handleReloadAndAdvance}
              reload={loadSession}
              onRestart={handleRestart}
            />
          )}
          {currentStep === 8 && (
            <StepReport
              session={session}
              sessionId={sessionId ?? ""}
              reload={loadSession}
              onRestart={handleRestart}
            />
          )}
        </div>
      </PageBody>
    </Page>
  );
}
