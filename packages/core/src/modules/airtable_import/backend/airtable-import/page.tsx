"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Page, PageBody } from "@open-mercato/ui/backend/Page";
import { DataTable } from "@open-mercato/ui/backend/DataTable";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@open-mercato/ui/primitives/button";
import { RowActions } from "@open-mercato/ui/backend/RowActions";
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall";
import { flash } from "@open-mercato/ui/backend/FlashMessages";
import { LoadingMessage, ErrorMessage } from "@open-mercato/ui/backend/detail";
import { useConfirmDialog } from "@open-mercato/ui/backend/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@open-mercato/ui/primitives/dialog";

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

type ImportSessionRow = {
  id: string;
  airtableBaseId: string;
  airtableBaseName?: string | null;
  status: ImportSessionStatus;
  currentStep: number;
  createdAt: string;
  recordsTotal: number;
  recordsDone: number;
  recordsFailed: number;
  recordsAttention: number;
};

type SessionsResponse = {
  items: ImportSessionRow[];
  total: number;
  page: number;
  totalPages: number;
};

const STATUS_LABELS: Record<ImportSessionStatus, string> = {
  draft: "Szkic",
  analyzing: "Analizowanie…",
  analyzed: "Przeanalizowano",
  ready: "Gotowy",
  planning: "Planowanie…",
  planned: "Zaplanowany",
  importing: "Importowanie…",
  done: "Zakończony",
  failed: "Błąd",
  cancelled: "Anulowany",
};

const STATUS_COLORS: Record<ImportSessionStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  analyzing: "bg-blue-100 text-blue-700",
  analyzed: "bg-blue-100 text-blue-700",
  ready: "bg-green-100 text-green-700",
  planning: "bg-orange-100 text-orange-700",
  planned: "bg-orange-100 text-orange-700",
  importing: "bg-orange-100 text-orange-700",
  done: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

function StatusBadge({ status }: { status: ImportSessionStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("pl-PL");
}

function RecordsCell({ row }: { row: ImportSessionRow }) {
  if (row.recordsTotal === 0)
    return <span className="text-muted-foreground">—</span>;
  return (
    <span className="tabular-nums text-sm">
      <span className="text-green-600">{row.recordsDone}</span>
      {row.recordsAttention > 0 && (
        <span className="text-yellow-600"> ⚠{row.recordsAttention}</span>
      )}
      {row.recordsFailed > 0 && (
        <span className="text-red-600"> ✗{row.recordsFailed}</span>
      )}
      <span className="text-muted-foreground"> / {row.recordsTotal}</span>
    </span>
  );
}

export default function AirtableImportListPage() {
  const router = useRouter();
  const { confirm, ConfirmDialogElement } = useConfirmDialog();

  const [rows, setRows] = React.useState<ImportSessionRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);

  const [newDialogOpen, setNewDialogOpen] = React.useState(false);
  const [newToken, setNewToken] = React.useState("");
  const [newBaseId, setNewBaseId] = React.useState("");
  const [isCreating, setIsCreating] = React.useState(false);

  const pageSize = 20;

  React.useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const load = async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await apiCall(`/api/airtable_import/sessions?${params}`);
      if (cancelled) return;
      if (!res.ok) {
        setError("Nie udało się załadować sesji importu");
        setIsLoading(false);
        return;
      }
      const data = res.result as unknown as SessionsResponse;
      setRows(data.items ?? []);
      setTotal(data.total ?? 0);
      setIsLoading(false);
    };

    load().catch((e: unknown) => {
      if (!cancelled) {
        setError(String(e));
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [page, reloadToken]);

  const handleCreate = React.useCallback(async () => {
    if (!newToken.trim() || !newBaseId.trim()) {
      flash("Wypełnij wszystkie pola", "error");
      return;
    }
    setIsCreating(true);
    const res = await apiCall("/api/airtable_import/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        airtableToken: newToken.trim(),
        airtableBaseId: newBaseId.trim(),
      }),
    });
    setIsCreating(false);
    if (!res.ok) {
      const err = await res.response.text().catch(() => "Nieznany błąd");
      flash(`Błąd tworzenia sesji: ${err}`, "error");
      return;
    }
    const session = res.result as unknown as { id: string };
    setNewDialogOpen(false);
    setNewToken("");
    setNewBaseId("");
    router.push(`/backend/airtable-import/${session.id}`);
  }, [newToken, newBaseId, router]);

  const handleDelete = React.useCallback(
    async (sessionId: string) => {
      const confirmed = await confirm({
        title: "Usuń sesję importu",
        text: "Tej operacji nie można cofnąć. Wszystkie dane sesji zostaną usunięte.",
        confirmText: "Usuń",
        cancelText: "Anuluj",
        variant: "destructive",
      });
      if (!confirmed) return;
      const res = await apiCall(`/api/airtable_import/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        flash("Sesja usunięta", "success");
        setReloadToken((t) => t + 1);
      } else {
        flash("Nie udało się usunąć sesji", "error");
      }
    },
    [confirm],
  );

  const columns: ColumnDef<ImportSessionRow>[] = React.useMemo(
    () => [
      {
        accessorKey: "airtableBaseName",
        header: "Baza Airtable",
        cell: ({ row }) =>
          row.original.airtableBaseName || row.original.airtableBaseId,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "records",
        header: "Rekordy",
        cell: ({ row }) => <RecordsCell row={row.original} />,
      },
      {
        accessorKey: "createdAt",
        header: "Utworzono",
        cell: ({ row }) => formatDate(row.original.createdAt),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <RowActions
            items={[
              {
                id: "open",
                label: "Otwórz",
                onSelect: () =>
                  router.push(`/backend/airtable-import/${row.original.id}`),
              },
              ...(row.original.status === "done" ||
              row.original.status === "failed" ||
              row.original.status === "cancelled"
                ? [
                    {
                      id: "rerun",
                      label: "Uruchom ponownie",
                      onSelect: () =>
                        router.push(
                          `/backend/airtable-import/${row.original.id}`,
                        ),
                    },
                  ]
                : []),
              {
                id: "delete",
                label: "Usuń",
                onSelect: () => handleDelete(row.original.id),
                destructive: true,
              },
            ]}
          />
        ),
      },
    ],
    [router, handleDelete],
  );

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Import z Airtable</h1>
          <Button type="button" onClick={() => setNewDialogOpen(true)}>
            Nowy import
          </Button>
        </div>

        {isLoading && <LoadingMessage label="Ładowanie sesji importu…" />}
        {!isLoading && error && <ErrorMessage label={error} />}
        {!isLoading && !error && (
          <DataTable
            columns={columns}
            data={rows}
            pagination={{
              total,
              page,
              pageSize,
              totalPages: Math.ceil(total / pageSize),
              onPageChange: setPage,
            }}
            onRowClick={(row) =>
              router.push(`/backend/airtable-import/${row.id}`)
            }
          />
        )}

        <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nowy import z Airtable</DialogTitle>
              <DialogDescription>
                Wprowadź dane dostępowe do bazy Airtable, którą chcesz
                zaimportować.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">
                  Token Airtable (Personal Access Token)
                </span>
                <input
                  type="password"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">ID bazy Airtable</span>
                <input
                  type="text"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="appXXXXXXXXXXXXXX"
                  value={newBaseId}
                  onChange={(e) => setNewBaseId(e.target.value)}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewDialogOpen(false)}
              >
                Anuluj
              </Button>
              <Button
                type="button"
                onClick={handleCreate}
                disabled={isCreating || !newToken.trim() || !newBaseId.trim()}
              >
                {isCreating ? "Tworzenie…" : "Utwórz sesję"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {ConfirmDialogElement}
      </PageBody>
    </Page>
  );
}
