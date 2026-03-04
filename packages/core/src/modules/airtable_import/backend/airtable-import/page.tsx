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
import { useT } from "@open-mercato/shared/lib/i18n/context";

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
        <h3 className="font-semibold">{t('airtable_import.dialog.rerun.title')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('airtable_import.dialog.rerun.description')}
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
              <p className="text-sm font-medium">{t('airtable_import.dialog.rerun.skipOption')}</p>
              <p className="text-xs text-muted-foreground">
                {t('airtable_import.dialog.rerun.skipHint')}
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
              <p className="text-sm font-medium">{t('airtable_import.dialog.rerun.overwriteOption')}</p>
              <p className="text-xs text-muted-foreground">
                {t('airtable_import.dialog.rerun.overwriteHint')}
              </p>
            </div>
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('airtable_import.buttons.cancel')}
          </Button>
          <Button type="button" onClick={() => onConfirm(preserveDone)}>
            {t('airtable_import.dialog.rerun.run')}
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

function getStatusLabels(t: ReturnType<typeof useT>) {
  return {
    draft: t('airtable_import.status.draft'),
    analyzing: t('airtable_import.status.analyzing'),
    analyzed: t('airtable_import.status.analyzed'),
    ready: t('airtable_import.status.ready'),
    planning: t('airtable_import.status.planning'),
    planned: t('airtable_import.status.planned'),
    importing: t('airtable_import.status.importing'),
    done: t('airtable_import.status.done'),
    failed: t('airtable_import.status.failed'),
    cancelled: t('airtable_import.status.cancelled'),
  } as const
}

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
  const t = useT();
  const statusLabels = getStatusLabels(t);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}
    >
      {statusLabels[status] ?? status}
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
  const t = useT();
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
        setError(t('airtable_import.list.errorLoading'));
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
      flash(t('airtable_import.dialog.new.validationError'), "error");
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
      const err = await res.response.text().catch(() => "Unknown error");
      flash(t('airtable_import.dialog.new.createError').replace('{err}', String(err)), "error");
      return;
    }
    const session = res.result as unknown as { id: string };
    setNewDialogOpen(false);
    setNewToken("");
    setNewBaseId("");
    router.push(`/backend/airtable-import/${session.id}`);
  }, [newToken, newBaseId, router, t]);

  const handleDelete = React.useCallback(
    async (sessionId: string) => {
      const confirmed = await confirm({
        title: t('airtable_import.dialog.delete.title'),
        text: t('airtable_import.dialog.delete.message'),
        confirmText: t('airtable_import.dialog.delete.confirm'),
        cancelText: t('airtable_import.buttons.cancel'),
        variant: "destructive",
      });
      if (!confirmed) return;
      const res = await apiCall(`/api/airtable_import/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        flash(t('airtable_import.messages.deleted'), "success");
        setReloadToken((tok) => tok + 1);
      } else {
        flash(t('airtable_import.messages.deleteError'), "error");
      }
    },
    [confirm, t],
  );

  const columns: ColumnDef<ImportSessionRow>[] = React.useMemo(
    () => [
      {
        accessorKey: "airtableBaseName",
        header: t('airtable_import.columns.base'),
        cell: ({ row }) =>
          row.original.airtableBaseName || row.original.airtableBaseId,
      },
      {
        accessorKey: "status",
        header: t('airtable_import.columns.status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "records",
        header: t('airtable_import.columns.records'),
        cell: ({ row }) => <RecordsCell row={row.original} />,
      },
      {
        accessorKey: "createdAt",
        header: t('airtable_import.columns.createdAt'),
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
                label: t('airtable_import.actions.open'),
                onSelect: () =>
                  router.push(`/backend/airtable-import/${row.original.id}`),
              },
              ...(row.original.status === "done" ||
              row.original.status === "failed" ||
              row.original.status === "cancelled"
                ? [
                    {
                      id: "rerun",
                      label: t('airtable_import.actions.rerun'),
                      onSelect: () =>
                        router.push(
                          `/backend/airtable-import/${row.original.id}`,
                        ),
                    },
                  ]
                : []),
              {
                id: "delete",
                label: t('airtable_import.actions.delete'),
                onSelect: () => handleDelete(row.original.id),
                destructive: true,
              },
            ]}
          />
        ),
      },
    ],
    [router, handleDelete, t],
  );

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">{t('airtable_import.list.heading')}</h1>
          <Button type="button" onClick={() => setNewDialogOpen(true)}>
            {t('airtable_import.list.newButton')}
          </Button>
        </div>

        {isLoading && <LoadingMessage label={t('airtable_import.list.loading')} />}
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
              <DialogTitle>{t('airtable_import.dialog.new.title')}</DialogTitle>
              <DialogDescription>
                {t('airtable_import.dialog.new.description')}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">
                  {t('airtable_import.dialog.new.tokenLabel')}
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
                <span className="text-sm font-medium">{t('airtable_import.dialog.new.baseIdLabel')}</span>
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
                {t('airtable_import.buttons.cancel')}
              </Button>
              <Button
                type="button"
                onClick={handleCreate}
                disabled={isCreating || !newToken.trim() || !newBaseId.trim()}
              >
                {isCreating ? t('airtable_import.dialog.new.creating') : t('airtable_import.dialog.new.create')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {ConfirmDialogElement}
      </PageBody>
    </Page>
  );
}
