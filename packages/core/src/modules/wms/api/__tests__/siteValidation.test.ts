import { CrudHttpError } from "@open-mercato/shared/lib/crud/errors";
import { parseScopedCommandInput } from "@open-mercato/shared/lib/api/scoped";
import {
  siteUpdateSchema,
  siteWarehouseRoleCreateSchema,
  siteWarehouseRoleUpdateSchema,
} from "../../data/validators";
import {
  assertSiteWarehouseRoleCustomFieldsUnsupported,
  booleanQueryFilterSchema,
  localizeSiteValidationResult,
  parseSiteWarehouseRoleUpdateInput,
  resolveSiteCustomFieldContext,
  transformSiteListItem,
  uuidListQueryFilterSchema,
} from "../siteValidation";

const translate = (key: string, fallback?: string): string =>
  `pl:${key}:${fallback ?? ""}`;

function expectLocalizedValidationError(operation: () => unknown) {
  try {
    operation();
    throw new Error("[internal] Expected validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(CrudHttpError);
    return error as CrudHttpError;
  }
}

describe("WMS Site validation responses", () => {
  it("localizes the empty Site update invariant", () => {
    const error = expectLocalizedValidationError(() =>
      localizeSiteValidationResult(
        () => siteUpdateSchema.parse({ id: "33333333-3333-4333-8333-333333333333" }),
        translate,
      ),
    );

    expect(error.body).toEqual({
      error:
        "pl:wms.sites.validation.mutableFieldRequired:Change at least one field.",
    });
  });

  it("localizes field-level Site warehouse role validation", () => {
    const error = expectLocalizedValidationError(() =>
      localizeSiteValidationResult(
        () =>
          siteWarehouseRoleUpdateSchema.parse({
            id: "not-a-uuid",
            warehouseId: "also-not-a-uuid",
          }),
        translate,
      ),
    );

    expect(error.body).toEqual({
      error: "pl:wms.sites.errors.invalidInput:Correct the highlighted form fields.",
      fieldErrors: {
        id: "pl:wms.sites.validation.id:The record identifier is invalid.",
        warehouseId: "pl:wms.sites.validation.warehouse:Select a valid warehouse.",
      },
    });
  });

  it("rejects invalid boolean and UUID-list query filters", () => {
    expect(booleanQueryFilterSchema.safeParse("yes").success).toBe(false);
    expect(booleanQueryFilterSchema.safeParse("false").success).toBe(true);
    expect(
      uuidListQueryFilterSchema.safeParse(
        "33333333-3333-4333-8333-333333333333,not-a-uuid",
      ).success,
    ).toBe(false);
    expect(
      uuidListQueryFilterSchema.safeParse(
        "33333333-3333-4333-8333-333333333333,44444444-4444-4444-8444-444444444444",
      ).success,
    ).toBe(true);
  });

  it("preserves raw custom-field entries until list decoration", () => {
    const transformed = transformSiteListItem({
      id: "33333333-3333-4333-8333-333333333333",
      organization_id: "22222222-2222-4222-8222-222222222222",
      tenant_id: "11111111-1111-4111-8111-111111111111",
      code: "PLANT",
      name: "Plant",
      is_active: true,
      cf_site_note: "Important",
      "cf:priority": 3,
    });

    expect(transformed).toMatchObject({
      id: "33333333-3333-4333-8333-333333333333",
      isActive: true,
      cf_site_note: "Important",
      "cf:priority": 3,
    });
    expect(Object.keys(transformed)).not.toContain("organization_id");
    expect(Object.keys(transformed)).not.toContain("tenant_id");
    expect(resolveSiteCustomFieldContext(transformed)).toEqual({
      organizationId: "22222222-2222-4222-8222-222222222222",
      tenantId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("localizes custom-field payload rejection for warehouse roles", () => {
    const context = {
      auth: {
        tenantId: "11111111-1111-4111-8111-111111111111",
        orgId: "22222222-2222-4222-8222-222222222222",
      },
      selectedOrganizationId: "22222222-2222-4222-8222-222222222222",
    };
    const error = expectLocalizedValidationError(() =>
      localizeSiteValidationResult(() => {
        const parsed = parseScopedCommandInput(
          siteWarehouseRoleCreateSchema,
          {
            siteId: "33333333-3333-4333-8333-333333333333",
            warehouseId: "44444444-4444-4444-8444-444444444444",
            role: "raw_material",
            cf_priority: "high",
          },
          context as never,
          translate,
        );
        assertSiteWarehouseRoleCustomFieldsUnsupported(parsed, translate);
        return parsed;
      }, translate),
    );

    expect(error.body).toEqual({
      error:
        "pl:wms.sites.roles.errors.customFieldsUnsupported:Custom fields are not supported for warehouse roles.",
    });

    const updateError = expectLocalizedValidationError(() =>
      parseSiteWarehouseRoleUpdateInput(
        {
          id: "33333333-3333-4333-8333-333333333333",
          isDefault: true,
          customFields: { priority: "high" },
        },
        translate,
      ),
    );
    expect(updateError.body).toEqual(error.body);
  });
});
