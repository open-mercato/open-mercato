"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Page, PageBody } from "@open-mercato/ui/backend/Page";
import { Button } from "@open-mercato/ui/primitives/button";
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall";
import { flash } from "@open-mercato/ui/backend/FlashMessages";
import { LoadingMessage, ErrorMessage } from "@open-mercato/ui/backend/detail";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import type {
  ImportSession,
  ImportMapping,
  ImportConfig,
  ImportProgress,
  StepProps,
  ImportLogEntry,
} from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

function getModuleOptions(t: ReturnType<typeof useT>) {
  return [
    { value: "customers.people", label: t("airtable_import.modules.people") },
    { value: "customers.companies", label: t("airtable_import.modules.companies") },
    { value: "customers.deals", label: t("airtable_import.modules.deals") },
    { value: "catalog.products", label: t("airtable_import.modules.products") },
    { value: "catalog.categories", label: t("airtable_import.modules.categories") },
    { value: "sales.orders", label: t("airtable_import.modules.orders") },
    { value: "sales.invoices", label: t("airtable_import.modules.invoices") },
    { value: "sales.quotes", label: t("airtable_import.modules.quotes") },
    { value: "staff.members", label: t("airtable_import.modules.staff") },
    { value: "tasks.tasks", label: t("airtable_import.modules.tasks") },
    { value: null, label: t("airtable_import.modules.custom") },
  ];
}

function getStepLabels(t: ReturnType<typeof useT>) {
  return [
    t("airtable_import.wizard.step1"),
    t("airtable_import.wizard.step2"),
    t("airtable_import.wizard.step3"),
    t("airtable_import.wizard.step4"),
    t("airtable_import.wizard.step5"),
    t("airtable_import.wizard.step6"),
    t("airtable_import.wizard.step7"),
    t("airtable_import.wizard.step8"),
  ];
}

// ─── Step 1: Connect ──────────────────────────────────────────────────────────

function StepConnect({ session, onNext, onRestart: _ }: StepProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">{t("airtable_import.step1.heading")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("airtable_import.step1.description")}
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
          {t('airtable_import.buttons.next')}
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
  const t = useT();
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    const res = await apiCall(
      `/api/airtable_import/sessions/${sessionId}/schema`,
      { method: "POST" },
    );
    setIsAnalyzing(false);
    if (res.ok) {
      flash(t("airtable_import.step2.successMessage"), "success");
      reload();
    } else {
      const err = await res.response.text().catch(() => t("airtable_import.status.failed"));
      flash(t("airtable_import.step2.errorMessage").replace("{err}", String(err)), "error");
    }
  };

  const isAnalyzed = session.status !== "draft" && session.mappingJson != null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">{t("airtable_import.step2.heading")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("airtable_import.step2.description")}
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
          {t('airtable_import.buttons.back')}
        </Button>
        <div className="flex gap-2">
          {!isAnalyzed && (
            <Button
              type="button"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? t("airtable_import.step2.analyzingButton") : t("airtable_import.step2.analyzeButton")}
            </Button>
          )}
          {isAnalyzed && (
            <Button type="button" onClick={onNext}>
              {t('airtable_import.buttons.next')}
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
  const t = useT();
  const moduleOptions = getModuleOptions(t);
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
      flash(errData?.error ?? t("airtable_import.step3.saveMappingError"), "error");
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
        <h2 className="text-lg font-semibold">{t("airtable_import.step3.heading")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("airtable_import.step3.description")}
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
                    {t("airtable_import.step3.fieldCount").replace("{n}", String(table.fieldMappings.length))}
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
                    {moduleOptions.map((opt) => (
                      <option key={opt.value} value={opt.value ?? "__custom__"}>
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
                    {t("airtable_import.buttons.skip")}
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          {t('airtable_import.buttons.back')}
        </Button>
        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? t('airtable_import.buttons.saving') : "{t('airtable_import.buttons.next')}"}
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
  const t = useT();
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
      flash(t("airtable_import.step4.saveMappingError"), "error");
    }
  };

  const activeTables = mapping.tables.filter((t) => !t.skip);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">{t("airtable_import.step4.heading")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("airtable_import.step4.description")}
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
                    {t("airtable_import.step4.activeFields")})
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
                          {t("airtable_import.step4.examplesColumn")}
                        </th>
                        <th className="w-[38%] px-4 py-2 text-left font-medium">
                          Klucz OM
                        </th>
                        <th className="w-[8%] px-4 py-2 text-center font-medium">
                          {t("airtable_import.step4.skipColumn")}
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
          {t('airtable_import.buttons.back')}
        </Button>
        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? t('airtable_import.buttons.saving') : "{t('airtable_import.buttons.next')}"}
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
  const t = useT();
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
      flash(t("airtable_import.step5.saveError"), "error");
    }
  };

  const options: Array<{
    key: keyof ImportConfig;
    label: string;
    description: string;
  }> = [
    {
      key: "preserveDates",
      label: t('airtable_import.step5.preserveDatesLabel'),
      description: t("airtable_import.step5.preserveDatesDescription"),
    },
    {
      key: "addAirtableIdField",
      label: t('airtable_import.step5.airtableIdLabel'),
      description: t("airtable_import.step5.airtableIdDescription"),
    },
    {
      key: "importAttachments",
      label: t("airtable_import.step5.attachments"),
      description: t("airtable_import.step5.attachmentsDescription"),
    },
    {
      key: "overwriteExisting",
      label: t("airtable_import.step5.overwrite"),
      description: t("airtable_import.step5.overwriteDescription"),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">{t("airtable_import.step5.heading")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('airtable_import.step5.extraDescription')}
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
          {t('airtable_import.buttons.back')}
        </Button>
        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? t('airtable_import.buttons.saving') : "{t('airtable_import.buttons.next')}"}
        </Button>
      </div>
    </div>
  );
}

// ─── Step 6: Plan ─────────────────────────────────────────────────────────────

function StepPlan({ session, sessionId, onNext, onBack, reload }: StepProps) {
  const t = useT();
  const [isPlanning, setIsPlanning] = React.useState(false);

  const handlePlan = async () => {
    setIsPlanning(true);
    const res = await apiCall(
      `/api/airtable_import/sessions/${sessionId}/plan`,
      { method: "POST" },
    );
    setIsPlanning(false);
    if (res.ok) {
      flash(t("airtable_import.step6.successMessage"), "success");
      reload();
    } else {
      flash(t("airtable_import.step6.errorMessage"), "error");
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
        <h2 className="text-lg font-semibold">{t("airtable_import.step6.heading")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("airtable_import.step6.description")}
        </p>
      </div>
      <div className="rounded-lg border p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="pb-2 text-left font-medium">{t("airtable_import.step6.tableColumn")}</th>
              <th className="pb-2 text-left font-medium">{t("airtable_import.step6.targetModuleColumn")}</th>
              <th className="pb-2 text-right font-medium">{t("airtable_import.step6.recordsColumn")}</th>
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
          {t('airtable_import.buttons.back')}
        </Button>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handlePlan}
            disabled={isPlanning}
          >
            {isPlanning
              ? t("airtable_import.step6.generating")
              : hasPlan
                ? "Regeneruj plan"
                : t("airtable_import.step6.generatePlan")}
          </Button>
          {hasPlan && allTablesHaveCounts && (
            <Button type="button" onClick={onNext}>
              {t('airtable_import.buttons.next')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 7: Execute ──────────────────────────────────────────────────────────

function StepExecute({
  session,
  sessionId,
  onNext,
  onRestart,
  reload,
}: Omit<StepProps, "onBack">) {
  const t = useT();
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
      flash(t("airtable_import.step7.runError"), "error");
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
      flash(t("airtable_import.step7.cancelError"), "error");
      return;
    }
    flash(t("airtable_import.step7.cancelledMessage"), "info");
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
        <h2 className="text-lg font-semibold">{t("airtable_import.step7.heading")}</h2>
        {!isImporting &&
          session.status !== "importing" &&
          session.status !== "cancelled" && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("airtable_import.step7.instructions")}
            </p>
          )}
        {session.status === "cancelled" && (
          <p className="mt-1 text-sm text-yellow-600">
            {t("airtable_import.step7.cancelledMessage")}
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
                t("airtable_import.step7.progressColumn")
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
              {t("airtable_import.step7.inProgressMessage")}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isCancelling}
            >
              {isCancelling ? t("airtable_import.step7.cancelling") : t("airtable_import.step7.cancelImport")}
            </Button>
          </>
        ) : (
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" onClick={onRestart}>
              {t("airtable_import.step7.restartFromBeginning")}
            </Button>
            <Button type="button" onClick={handleStart} disabled={isStarting}>
              {isStarting
                ? "Uruchamianie…"
                : session.status === "done"
                  ? t("airtable_import.step7.runAgain")
                  : t("airtable_import.step7.runImport")}
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
  const t = useT();
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
      flash(t("airtable_import.step7.retryError"), "error");
    }
  };

  if (!report) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t("airtable_import.step8.heading")}</h2>
        <p className="text-sm text-muted-foreground">{t("airtable_import.step8.notAvailable")}</p>
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
        <h2 className="text-lg font-semibold">{t("airtable_import.step8.heading")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("airtable_import.step8.done")}{" "}
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
          <p className="text-xs text-muted-foreground">{t("airtable_import.step7.errorsLabel")}</p>
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
            {isRetrying ? t("airtable_import.step7.retrying") : t("airtable_import.step7.retryFailed")}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onRestart}>
          {t("airtable_import.step8.rerun")}
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
  const t = useT();
  const [preserveDone, setPreserveDone] = React.useState(true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg">
        <h3 className="font-semibold">{t("airtable_import.dialog.rerun.title")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("airtable_import.dialog.rerun.description")}
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
              <p className="text-sm font-medium">{t("airtable_import.dialog.rerun.skipOption")}</p>
              <p className="text-xs text-muted-foreground">
                {t("airtable_import.dialog.rerun.skipHint")}
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
              <p className="text-sm font-medium">{t("airtable_import.dialog.rerun.overwriteOption")}</p>
              <p className="text-xs text-muted-foreground">
                {t("airtable_import.dialog.rerun.overwriteHint")}
              </p>
            </div>
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("airtable_import.buttons.cancel")}
          </Button>
          <Button type="button" onClick={() => onConfirm(preserveDone)}>
            {t("airtable_import.dialog.rerun.run")}
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
  const t = useT();
  const stepLabels = getStepLabels(t);
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
      setError(t("airtable_import.session.loadError"));
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

  if (isLoading) return <LoadingMessage label={t("airtable_import.session.loading")} />;
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
              {t("airtable_import.nav.backToList")}
            </Button>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm font-medium">
              {session.airtableBaseName ?? session.airtableBaseId}
            </span>
          </div>

          <StepIndicator current={currentStep} total={8} />

          <p className="mb-6 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {stepLabels[currentStep - 1]}
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
