import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { StatusBadge } from "@open-mercato/ui/primitives/status-badge";
import type { SiteWarehouseRoleRow } from "./SiteWarehouseRoleDialog";

type Translate = (key: string, fallback?: string) => string;

export function warehouseLabel(row: SiteWarehouseRoleRow): string {
  return row.warehouse.name || row.warehouse.code || row.warehouse.id;
}

export function buildSiteWarehouseRoleColumns(
  t: Translate,
): ColumnDef<SiteWarehouseRoleRow>[] {
  return [
    {
      accessorKey: "role",
      header: t("wms.sites.roles.columns.role", "Role"),
      cell: ({ row }) =>
        t(`wms.sites.roles.role.${row.original.role}`, row.original.role),
    },
    {
      id: "warehouse",
      header: t("wms.sites.roles.columns.warehouse", "Warehouse"),
      cell: ({ row }) => (
        <div className="space-y-1">
          <span>{warehouseLabel(row.original)}</span>
          {!row.original.warehouse.isActive ? (
            <StatusBadge variant="warning">
              {t("wms.sites.roles.warehouseInactive", "Warehouse inactive")}
            </StatusBadge>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: "isDefault",
      header: t("wms.sites.roles.columns.default", "Default"),
      cell: ({ row }) =>
        row.original.isDefault ? (
          <StatusBadge variant="success">{t("common.yes", "Yes")}</StatusBadge>
        ) : (
          t("common.no", "No")
        ),
    },
  ];
}
