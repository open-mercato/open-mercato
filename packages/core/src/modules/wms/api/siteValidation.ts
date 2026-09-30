import { z } from "zod";
import { CrudHttpError } from "@open-mercato/shared/lib/crud/errors";
import type { TranslateFn } from "@open-mercato/shared/lib/api/scoped";
import {
  SITE_MUTABLE_FIELD_REQUIRED,
  siteWarehouseRoleUpdateSchema,
  type SiteWarehouseRoleUpdateInput,
} from "../data/validators";

export const booleanQueryFilterSchema = z.enum(["true", "false"]);
export const uuidListQueryFilterSchema = z.string().refine(
  (value) => {
    const ids = value
      .split(",")
      .map((item) => item.trim());
    return (
      ids.length > 0 &&
      ids.every(
        (item) => item.length > 0 && z.string().uuid().safeParse(item).success,
      )
    );
  },
  { message: "Invalid UUID list." },
);

const SITE_CUSTOM_FIELD_SCOPE = Symbol("wms.siteCustomFieldScope");

type SiteCustomFieldScope = {
  organizationId: string | null;
  tenantId: string | null;
};

export function transformSiteListItem(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const customFieldEntries = Object.fromEntries(
    Object.entries(item).filter(
      ([key]) => key.startsWith("cf_") || key.startsWith("cf:"),
    ),
  );
  const transformed = {
    id: item.id,
    code: item.code ?? null,
    name: item.name ?? null,
    isActive: item.is_active === true,
    ...customFieldEntries,
    customValues: item.customValues ?? {},
    customFields: item.customFields ?? [],
    createdAt: item.created_at ?? null,
    updatedAt: item.updated_at ?? null,
  };
  Object.defineProperty(transformed, SITE_CUSTOM_FIELD_SCOPE, {
    value: {
      organizationId:
        typeof item.organization_id === "string" ? item.organization_id : null,
      tenantId: typeof item.tenant_id === "string" ? item.tenant_id : null,
    } satisfies SiteCustomFieldScope,
    enumerable: false,
  });
  return transformed;
}

export function resolveSiteCustomFieldContext(
  item: Record<string, unknown>,
): SiteCustomFieldScope {
  const scope = (item as Record<PropertyKey, unknown>)[
    SITE_CUSTOM_FIELD_SCOPE
  ];
  if (!scope || typeof scope !== "object")
    return { organizationId: null, tenantId: null };
  const candidate = scope as Partial<SiteCustomFieldScope>;
  return {
    organizationId:
      typeof candidate.organizationId === "string"
        ? candidate.organizationId
        : null,
    tenantId:
      typeof candidate.tenantId === "string" ? candidate.tenantId : null,
  };
}

type SiteValidationField =
  | "code"
  | "name"
  | "warehouseId"
  | "role"
  | "isDefault"
  | "id";

const FIELD_MESSAGES: Record<
  SiteValidationField,
  { key: string; fallback: string }
> = {
  code: {
    key: "wms.sites.validation.code",
    fallback: "Enter a code between 1 and 80 characters.",
  },
  name: {
    key: "wms.sites.validation.name",
    fallback: "Enter a name between 1 and 200 characters.",
  },
  warehouseId: {
    key: "wms.sites.validation.warehouse",
    fallback: "Select a valid warehouse.",
  },
  role: {
    key: "wms.sites.validation.role",
    fallback: "Select a valid warehouse role.",
  },
  isDefault: {
    key: "wms.sites.validation.isDefault",
    fallback: "Select a valid default setting.",
  },
  id: {
    key: "wms.sites.validation.id",
    fallback: "The record identifier is invalid.",
  },
};

function getField(issue: z.ZodIssue): SiteValidationField | null {
  const field = issue.path[0];
  return typeof field === "string" && field in FIELD_MESSAGES
    ? (field as SiteValidationField)
    : null;
}

export function localizeSiteValidationError(
  error: z.ZodError,
  translate: TranslateFn,
): never {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = getField(issue);
    if (field && !fieldErrors[field]) {
      const message = FIELD_MESSAGES[field];
      fieldErrors[field] = translate(message.key, message.fallback);
    }
  }
  const mutableFieldRequired = error.issues.some(
    (issue) => issue.message === SITE_MUTABLE_FIELD_REQUIRED,
  );
  const fallback = mutableFieldRequired
    ? "Change at least one field."
    : "Correct the highlighted form fields.";
  const key = mutableFieldRequired
    ? "wms.sites.validation.mutableFieldRequired"
    : "wms.sites.errors.invalidInput";
  throw new CrudHttpError(400, {
    error: translate(key, fallback),
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
  });
}

export function parseSiteWarehouseRoleUpdateInput(
  payload: unknown,
  translate: TranslateFn,
): SiteWarehouseRoleUpdateInput {
  assertSiteWarehouseRoleCustomFieldsUnsupported(payload, translate);
  try {
    return siteWarehouseRoleUpdateSchema.parse(payload ?? {});
  } catch (error) {
    if (error instanceof z.ZodError) localizeSiteValidationError(error, translate);
    throw error;
  }
}

export function assertSiteWarehouseRoleCustomFieldsUnsupported(
  input: unknown,
  translate: TranslateFn,
): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const keys = Object.keys(input as Record<string, unknown>);
  const hasCustomFields = keys.some(
    (key) =>
      key === "customFields" || key.startsWith("cf_") || key.startsWith("cf:"),
  );
  if (!hasCustomFields) return;
  throw new CrudHttpError(400, {
    error: translate(
      "wms.sites.roles.errors.customFieldsUnsupported",
      "Custom fields are not supported for warehouse roles.",
    ),
  });
}

export function localizeSiteValidationResult<T>(
  operation: () => T,
  translate: TranslateFn,
): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof z.ZodError) localizeSiteValidationError(error, translate);
    throw error;
  }
}
