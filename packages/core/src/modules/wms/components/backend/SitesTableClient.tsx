"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { DataTable } from "@open-mercato/ui/backend/DataTable";
import type {
  FilterDef,
  FilterValues,
} from "@open-mercato/ui/backend/FilterBar";
import { EmptyState } from "@open-mercato/ui/backend/EmptyState";
import { RowActions } from "@open-mercato/ui/backend/RowActions";
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall";
import { raiseCrudError } from "@open-mercato/ui/backend/utils/serverErrors";
import { Button } from "@open-mercato/ui/primitives/button";
import { StatusBadge } from "@open-mercato/ui/primitives/status-badge";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { Factory } from "lucide-react";
import { E } from "#generated/entities.ids.generated";
import { extensionPoints } from "../../extension-points";
import { buildQuery } from "./wmsLookupLoaders";
import { type Paged, type Site, useCanManageSites } from "./wmsSitesShared";

export function SitesTableClient() {
  const t = useT();
  const router = useRouter();
  const canManage = useCanManageSites();
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState("");
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "updatedAt", desc: true },
  ]);
  const [filterValues, setFilterValues] = React.useState<FilterValues>({});
  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: "isActive",
        label: t("wms.sites.filters.status", "Status"),
        type: "select",
        options: [
          { value: "true", label: t("wms.sites.filters.active", "Active") },
          {
            value: "false",
            label: t("wms.sites.filters.inactive", "Inactive"),
          },
        ],
      },
    ],
    [t],
  );
  const params = React.useMemo(() => {
    const sort = sorting[0];
    const isActive =
      typeof filterValues.isActive === "string"
        ? filterValues.isActive
        : undefined;
    return buildQuery({
      page,
      pageSize: 10,
      search: search.trim() || undefined,
      isActive,
      sortField: sort?.id ?? "updatedAt",
      sortDir: sort?.desc ? "desc" : "asc",
    });
  }, [filterValues.isActive, page, search, sorting]);
  const query = useQuery({
    queryKey: ["wms-sites", params],
    queryFn: async () => {
      const call = await apiCall<Paged<Site>>(`/api/wms/sites?${params}`, {
        cache: "no-store",
      });
      if (!call.ok)
        await raiseCrudError(
          call.response,
          t("wms.sites.errors.load", "Failed to load sites."),
        );
      return call.result ?? { items: [], total: 0, totalPages: 1 };
    },
  });
  const columns = React.useMemo<ColumnDef<Site>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("wms.sites.columns.name", "Name"),
        enableSorting: true,
      },
      {
        accessorKey: "code",
        header: t("wms.sites.columns.code", "Code"),
        enableSorting: true,
      },
      {
        accessorKey: "isActive",
        header: t("wms.sites.columns.status", "Status"),
        enableSorting: true,
        cell: ({ row }) => (
          <StatusBadge
            variant={row.original.isActive ? "success" : "neutral"}
            dot
          >
            {row.original.isActive
              ? t("wms.common.active", "Active")
              : t("wms.common.inactive", "Inactive")}
          </StatusBadge>
        ),
      },
    ],
    [t],
  );
  return (
    <DataTable
      title={
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Factory
            className="size-5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span>{t("wms.sites.title", "Sites")}</span>
        </h2>
      }
      columns={columns}
      data={query.data?.items ?? []}
      isLoading={query.isLoading}
      error={
        query.isError
          ? t("wms.sites.errors.load", "Failed to load sites.")
          : null
      }
      entityId={E.wms.site}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value);
        setPage(1);
      }}
      searchPlaceholder={t("wms.sites.search", "Search sites")}
      filters={filters}
      filterValues={filterValues}
      onFiltersApply={(values) => {
        setFilterValues(values);
        setPage(1);
      }}
      onFiltersClear={() => {
        setFilterValues({});
        setPage(1);
      }}
      sorting={sorting}
      onSortingChange={(nextSorting) => {
        setSorting(nextSorting);
        setPage(1);
      }}
      sortable
      manualSorting
      actions={
        canManage ? (
          <Button
            type="button"
            size="sm"
            onClick={() => router.push("/backend/wms/sites/create")}
          >
            {t("wms.sites.create", "Create site")}
          </Button>
        ) : null
      }
      rowActions={(row) => (
        <RowActions
          items={[
            {
              id: "open",
              label: t("common.open", "Open"),
              onSelect: () =>
                router.push(`/backend/wms/sites/${encodeURIComponent(row.id)}`),
            },
            ...(canManage
              ? [
                  {
                    id: "edit",
                    label: t("common.edit", "Edit"),
                    onSelect: () =>
                      router.push(
                        `/backend/wms/sites/${encodeURIComponent(row.id)}`,
                      ),
                  },
                ]
              : []),
          ]}
        />
      )}
      pagination={{
        page,
        pageSize: 10,
        total: query.data?.total ?? 0,
        totalPages: query.data?.totalPages ?? 1,
        onPageChange: setPage,
      }}
      perspective={{ tableId: extensionPoints.hosts.sitesTable.tableId }}
      extensionTableId={extensionPoints.hosts.sitesTable.tableId}
      emptyState={
        <EmptyState
          title={t("wms.sites.empty.title", "No sites")}
          description={t(
            "wms.sites.empty.description",
            "Create a site to configure its warehouse roles.",
          )}
          action={
            canManage
              ? {
                  label: t("wms.sites.create", "Create site"),
                  onClick: () => router.push("/backend/wms/sites/create"),
                }
              : undefined
          }
        />
      }
    />
  );
}
