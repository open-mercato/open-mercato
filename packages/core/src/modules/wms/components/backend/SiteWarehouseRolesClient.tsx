"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@open-mercato/ui/backend/DataTable";
import { useConfirmDialog } from "@open-mercato/ui/backend/confirm-dialog";
import { EmptyState } from "@open-mercato/ui/backend/EmptyState";
import { flash } from "@open-mercato/ui/backend/FlashMessages";
import { useGuardedMutation } from "@open-mercato/ui/backend/injection/useGuardedMutation";
import { RowActions } from "@open-mercato/ui/backend/RowActions";
import {
  apiCall,
  withScopedApiRequestHeaders,
} from "@open-mercato/ui/backend/utils/apiCall";
import { deleteCrud } from "@open-mercato/ui/backend/utils/crud";
import { buildOptimisticLockHeader } from "@open-mercato/ui/backend/utils/optimisticLock";
import { raiseCrudError } from "@open-mercato/ui/backend/utils/serverErrors";
import { Button } from "@open-mercato/ui/primitives/button";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { E } from "#generated/entities.ids.generated";
import { extensionPoints } from "../../extension-points";
import { flashMutationError } from "../../lib/flashMutationError";
import {
  SiteWarehouseRoleDialog,
  type SiteWarehouseRoleRow,
  type SiteWarehouseRoleType,
} from "./SiteWarehouseRoleDialog";
import {
  buildSiteWarehouseRoleDefaultsListPath,
  buildSiteWarehouseRolesListPath,
  SITE_WAREHOUSE_ROLES_PAGE_SIZE,
  type Paged,
  useCanManageSites,
} from "./wmsSitesShared";
import {
  buildSiteWarehouseRoleColumns,
  warehouseLabel,
} from "./siteWarehouseRoleColumns";

export function SiteWarehouseRolesClient({
  siteId,
  embedded = false,
}: {
  siteId: string;
  embedded?: boolean;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const canManage = useCanManageSites();
  const { confirm, ConfirmDialogElement } = useConfirmDialog();
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: "wms-site-warehouse-roles",
  });
  const [page, setPage] = React.useState(1);
  const [dialogRow, setDialogRow] = React.useState<
    SiteWarehouseRoleRow | null | undefined
  >(undefined);
  const query = useQuery({
    queryKey: ["wms-site-roles", siteId, page],
    queryFn: async () => {
      const call = await apiCall<Paged<SiteWarehouseRoleRow>>(
        buildSiteWarehouseRolesListPath(siteId, page),
        { cache: "no-store" },
      );
      if (!call.ok)
        await raiseCrudError(
          call.response,
          t("wms.sites.roles.errors.load", "Failed to load warehouse roles."),
        );
      return call.result ?? { items: [], total: 0, totalPages: 1 };
    },
  });
  const defaultsQuery = useQuery({
    queryKey: ["wms-site-role-defaults", siteId],
    queryFn: async () => {
      const call = await apiCall<Paged<SiteWarehouseRoleRow>>(
        buildSiteWarehouseRoleDefaultsListPath(siteId),
        { cache: "no-store" },
      );
      if (!call.ok)
        await raiseCrudError(
          call.response,
          t("wms.sites.roles.errors.load", "Failed to load warehouse roles."),
        );
      return call.result ?? { items: [], total: 0, totalPages: 1 };
    },
  });
  const defaultRoles = React.useMemo(
    () =>
      (defaultsQuery.data?.items ?? []).map(
        (item) => item.role,
      ) as SiteWarehouseRoleType[],
    [defaultsQuery.data?.items],
  );
  const rows = React.useMemo(
    () =>
      [...(query.data?.items ?? [])].sort(
        (left, right) =>
          left.role.localeCompare(right.role) ||
          Number(right.isDefault) - Number(left.isDefault) ||
          warehouseLabel(left).localeCompare(warehouseLabel(right)),
      ),
    [query.data?.items],
  );
  const refresh = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["wms-site-roles", siteId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["wms-site-role-defaults", siteId],
      }),
    ]);
  }, [queryClient, siteId]);
  const remove = React.useCallback(
    async (row: SiteWarehouseRoleRow) => {
      const confirmed = await confirm({
        title: t(
          "wms.sites.roles.confirmDelete",
          'Remove warehouse role "{warehouse}"?',
          { warehouse: warehouseLabel(row) },
        ),
        variant: "destructive",
      });
      if (!confirmed) return;
      try {
        await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(
              buildOptimisticLockHeader(row.updatedAt),
              () =>
                deleteCrud("wms/site-warehouse-roles", row.id, {
                  errorMessage: t(
                    "wms.sites.roles.errors.delete",
                    "Failed to remove warehouse role.",
                  ),
                }),
            ),
          context: {},
          mutationPayload: { id: row.id },
        });
        flash(
          t("wms.sites.roles.flash.deleted", "Warehouse role removed."),
          "success",
        );
        await refresh();
      } catch (error) {
        flashMutationError(
          error,
          t(
            "wms.sites.roles.errors.delete",
            "Failed to remove warehouse role.",
          ),
          t,
        );
      }
    },
    [confirm, refresh, runMutation, t],
  );
  const columns = React.useMemo(() => buildSiteWarehouseRoleColumns(t), [t]);
  return (
    <>
      <DataTable
        embedded={embedded}
        title={t("wms.sites.roles.title", "Warehouse roles")}
        columns={columns}
        data={rows}
        isLoading={query.isLoading || defaultsQuery.isLoading}
        error={
          query.isError || defaultsQuery.isError
            ? t(
                "wms.sites.roles.errors.load",
                "Failed to load warehouse roles.",
              )
            : null
        }
        entityId={E.wms.site_warehouse_role}
        pagination={{
          page,
          pageSize: SITE_WAREHOUSE_ROLES_PAGE_SIZE,
          total: query.data?.total ?? 0,
          totalPages: query.data?.totalPages ?? 1,
          totalIsCapped: query.data?.totalIsCapped === true,
          onPageChange: setPage,
        }}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void refresh();
              }}
            >
              {t("common.refresh", "Refresh")}
            </Button>
            {canManage ? (
              <Button
                type="button"
                size="sm"
                disabled={!defaultsQuery.isSuccess}
                onClick={() => setDialogRow(null)}
              >
                {t("wms.sites.roles.create", "Add warehouse role")}
              </Button>
            ) : null}
          </div>
        }
        rowActions={(row) =>
          canManage ? (
            <RowActions
              items={[
                {
                  id: "edit",
                  label: t("common.edit", "Edit"),
                  onSelect: () => setDialogRow(row),
                },
                {
                  id: "delete",
                  label: t("common.delete", "Delete"),
                  destructive: true,
                  onSelect: () => {
                    void remove(row);
                  },
                },
              ]}
            />
          ) : null
        }
        extensionTableId={extensionPoints.hosts.siteWarehouseRolesTable.tableId}
        emptyState={
          <EmptyState
            title={t("wms.sites.roles.empty.title", "No warehouse roles")}
            description={t(
              "wms.sites.roles.empty.description",
              "Assign active warehouses to define this site’s operational roles.",
            )}
            action={
              canManage && defaultsQuery.isSuccess
                ? {
                    label: t("wms.sites.roles.create", "Add warehouse role"),
                    onClick: () => setDialogRow(null),
                  }
                : undefined
            }
          />
        }
      />
      {dialogRow !== undefined ? (
        <SiteWarehouseRoleDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialogRow(undefined);
          }}
          siteId={siteId}
          row={dialogRow}
          defaultRoles={defaultRoles}
          onSaved={refresh}
        />
      ) : null}
      {ConfirmDialogElement}
    </>
  );
}
