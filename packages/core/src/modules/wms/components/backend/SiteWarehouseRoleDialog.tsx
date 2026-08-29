"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@open-mercato/ui/primitives/dialog";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import {
  SiteWarehouseRoleDialogForm,
  type SiteWarehouseRoleDialogFormProps,
  type SiteWarehouseRoleRow,
  type SiteWarehouseRoleType,
} from "./SiteWarehouseRoleDialogForm";

export type {
  SiteWarehouseRoleRow,
  SiteWarehouseRoleType,
} from "./SiteWarehouseRoleDialogForm";

type Props = Omit<SiteWarehouseRoleDialogFormProps, "onOpenChange"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SiteWarehouseRoleDialog({
  open,
  onOpenChange,
  siteId,
  row,
  defaultRoles,
  onSaved,
}: Props) {
  const t = useT();
  const dialogRef = React.useRef<HTMLDivElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={dialogRef}
        className="max-w-3xl"
        onSubmit={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            dialogRef.current?.querySelector("form")?.requestSubmit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {row
              ? t("wms.sites.roles.dialog.edit", "Edit warehouse role")
              : t("wms.sites.roles.dialog.create", "Add warehouse role")}
          </DialogTitle>
        </DialogHeader>
        <SiteWarehouseRoleDialogForm
          onOpenChange={onOpenChange}
          siteId={siteId}
          row={row}
          defaultRoles={defaultRoles}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}
