"use client";

import * as React from "react";
import { z } from "zod";
import {
  CrudForm,
  type CrudField,
  type CrudFieldOption,
} from "@open-mercato/ui/backend/CrudForm";
import { flash } from "@open-mercato/ui/backend/FlashMessages";
import { useGuardedMutation } from "@open-mercato/ui/backend/injection/useGuardedMutation";
import { ComboboxInput } from "@open-mercato/ui/backend/inputs/ComboboxInput";
import { createCrud, updateCrud } from "@open-mercato/ui/backend/utils/crud";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@open-mercato/ui/primitives/select";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { E } from "#generated/entities.ids.generated";
import { flashMutationError } from "../../lib/flashMutationError";
import { loadActiveWarehouseOptions } from "./wmsLookupLoaders";

const roles = [
  "raw_material",
  "line_side",
  "wip",
  "finished_goods",
  "quarantine",
  "shipping",
] as const;
export type SiteWarehouseRoleType = (typeof roles)[number];

export type SiteWarehouseRoleRow = {
  id: string;
  siteId: string;
  warehouseId: string;
  role: SiteWarehouseRoleType;
  isDefault: boolean;
  updatedAt: string | null;
  warehouse: {
    id: string;
    code: string | null;
    name: string | null;
    isActive: boolean;
  };
};

type SiteWarehouseRoleFormValues = {
  id?: string;
  role: SiteWarehouseRoleType;
  warehouseId: string;
  isDefault: boolean;
  updatedAt?: string | null;
};

function createSchema(t: ReturnType<typeof useT>) {
  return z.object({
    id: z
      .string()
      .uuid(t("wms.sites.validation.id", "The record identifier is invalid."))
      .optional(),
    role: z.enum(roles, {
      message: t(
        "wms.sites.validation.role",
        "Select a valid warehouse role.",
      ),
    }),
    warehouseId: z
      .string()
      .uuid(
        t(
          "wms.sites.validation.warehouse",
          "Select a valid warehouse.",
        ),
      ),
    isDefault: z.boolean().default(false),
    updatedAt: z.string().nullable().optional(),
  });
}

export type SiteWarehouseRoleDialogFormProps = {
  onOpenChange: (open: boolean) => void;
  siteId: string;
  row?: SiteWarehouseRoleRow | null;
  defaultRoles: readonly SiteWarehouseRoleType[];
  onSaved: () => void | Promise<void>;
};

function warehouseOption(
  row: SiteWarehouseRoleRow | null | undefined,
): CrudFieldOption[] | undefined {
  if (!row?.warehouseId) return undefined;
  return [
    {
      value: row.warehouseId,
      label: row.warehouse.name || row.warehouse.code || row.warehouseId,
    },
  ];
}

export function SiteWarehouseRoleDialogForm({
  onOpenChange,
  siteId,
  row,
  defaultRoles,
  onSaved,
}: SiteWarehouseRoleDialogFormProps) {
  const t = useT();
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: "wms-site-warehouse-role-form",
  });
  const [submitting, setSubmitting] = React.useState(false);
  const isEdit = Boolean(row);
  const schema = React.useMemo(() => createSchema(t), [t]);
  const seedOptions = React.useMemo(() => warehouseOption(row), [row]);
  const roleHasDefault = React.useCallback(
    (role: SiteWarehouseRoleType) => defaultRoles.includes(role),
    [defaultRoles],
  );
  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: "role",
        type: "custom",
        label: t("wms.sites.roles.form.role", "Warehouse role"),
        required: true,
        disabled: isEdit,
        component: ({ disabled, setFormValue, setValue, value }) => {
          const selectedRole =
            typeof value === "string" &&
            roles.includes(value as SiteWarehouseRoleType)
              ? (value as SiteWarehouseRoleType)
              : roles[0];
          return (
            <Select
              value={selectedRole}
              disabled={disabled}
              onValueChange={(nextRole) => {
                const role = nextRole as SiteWarehouseRoleType;
                setValue(role);
                if (!isEdit)
                  setFormValue?.("isDefault", !roleHasDefault(role));
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role} value={role}>
                    {t(`wms.sites.roles.role.${role}`, role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        },
      },
      {
        id: "warehouseId",
        type: "custom",
        label: t("wms.sites.roles.form.warehouse", "Warehouse"),
        required: true,
        component: ({ disabled, setValue, value }) => (
          <ComboboxInput
            value={typeof value === "string" ? value : ""}
            onChange={setValue}
            placeholder={t(
              "wms.sites.roles.form.warehousePlaceholder",
              "Select warehouse",
            )}
            seedOptions={seedOptions}
            loadSuggestions={loadActiveWarehouseOptions}
            allowCustomValues={false}
            disabled={disabled}
          />
        ),
      },
      {
        id: "isDefault",
        type: "checkbox",
        disabled: isEdit && row?.isDefault === true,
        label: t(
          "wms.sites.roles.form.default",
          "Use as the default warehouse for this role",
        ),
        description: t(
          "wms.sites.roles.form.defaultDescription",
          "Changing the default does not move inventory.",
        ),
      },
    ],
    [isEdit, roleHasDefault, row?.isDefault, seedOptions, t],
  );
  const initialValues = React.useMemo<SiteWarehouseRoleFormValues>(
    () =>
      row
        ? {
            id: row.id,
            role: row.role,
            warehouseId: row.warehouseId,
            isDefault: row.isDefault,
            updatedAt: row.updatedAt,
          }
        : {
            role: "raw_material",
            warehouseId: "",
            isDefault: !roleHasDefault("raw_material"),
          },
    [roleHasDefault, row],
  );
  const submit = React.useCallback(
    async (values: SiteWarehouseRoleFormValues) => {
      setSubmitting(true);
      const payload = row
        ? {
            id: row.id,
            warehouseId: values.warehouseId,
            isDefault: values.isDefault,
          }
        : { siteId, ...values };
      try {
        await runMutation({
          operation: async () =>
            row
              ? updateCrud("wms/site-warehouse-roles", payload, {
                  errorMessage: t(
                    "wms.sites.roles.errors.save",
                    "Failed to save warehouse role.",
                  ),
                })
              : createCrud("wms/site-warehouse-roles", payload, {
                  errorMessage: t(
                    "wms.sites.roles.errors.save",
                    "Failed to save warehouse role.",
                  ),
                }),
          context: {},
          mutationPayload: payload,
        });
        flash(
          row
            ? t("wms.sites.roles.flash.updated", "Warehouse role updated.")
            : t("wms.sites.roles.flash.created", "Warehouse role added."),
          "success",
        );
        onOpenChange(false);
        await onSaved();
      } catch (error) {
        flashMutationError(
          error,
          t("wms.sites.roles.errors.save", "Failed to save warehouse role."),
          t,
        );
        throw error;
      } finally {
        setSubmitting(false);
      }
    },
    [onOpenChange, onSaved, row, runMutation, siteId, t],
  );

  return (
    <CrudForm<SiteWarehouseRoleFormValues>
      schema={schema}
      fields={fields}
      entityId={E.wms.site_warehouse_role}
      initialValues={initialValues}
      submitLabel={t("common.save", "Save")}
      onSubmit={submit}
      embedded
      disableInitialFocus
      isLoading={submitting}
      optimisticLockUpdatedAt={row?.updatedAt ?? undefined}
    />
  );
}
