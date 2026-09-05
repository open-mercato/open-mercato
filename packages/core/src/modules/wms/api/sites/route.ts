import { z } from "zod";
import { makeCrudRoute } from "@open-mercato/shared/lib/crud/factory";
import { resolveTranslations } from "@open-mercato/shared/lib/i18n/server";
import { parseScopedCommandInput } from "@open-mercato/shared/lib/api/scoped";
import { escapeLikePattern } from "@open-mercato/shared/lib/db/escapeLikePattern";
import { E } from "#generated/entities.ids.generated";
import { Site } from "../../data/entities";
import { siteCreateSchema, siteUpdateSchema } from "../../data/validators";
import {
  booleanQueryFilterSchema,
  localizeSiteValidationResult,
  resolveSiteCustomFieldContext,
  transformSiteListItem,
  uuidListQueryFilterSchema,
} from "../siteValidation";
import {
  createPagedListResponseSchema,
  createWmsCrudOpenApi,
  defaultOkResponseSchema,
} from "../openapi";

const metadata = {
  GET: { requireAuth: true, requireFeatures: ["wms.view"] },
  POST: { requireAuth: true, requireFeatures: ["wms.manage_sites"] },
  PUT: { requireAuth: true, requireFeatures: ["wms.manage_sites"] },
};
export { metadata };

const rawBodySchema = z.object({}).passthrough();
const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(25),
    search: z.string().optional(),
    ids: uuidListQueryFilterSchema.optional(),
    isActive: booleanQueryFilterSchema.optional(),
    sortField: z
      .enum(["code", "name", "isActive", "createdAt", "updatedAt"])
      .optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  })
  .passthrough();

const crud = makeCrudRoute({
  metadata,
  orm: {
    entity: Site,
    idField: "id",
    orgField: "organizationId",
    tenantField: "tenantId",
    softDeleteField: "deletedAt",
  },
  indexer: { entityType: E.wms.site },
  list: {
    schema: listSchema,
    disableListCache: true,
    entityId: E.wms.site,
    fields: [
      "id",
      "organization_id",
      "tenant_id",
      "code",
      "name",
      "is_active",
      "created_at",
      "updated_at",
    ],
    sortFieldMap: {
      code: "code",
      name: "name",
      isActive: "is_active",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    decorateCustomFields: {
      entityIds: [E.wms.site],
      stripPrefixedKeys: true,
      resolveContext: resolveSiteCustomFieldContext,
    },
    transformItem: transformSiteListItem,
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {};
      if (query.ids)
        filters.id = {
          $in: query.ids
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        };
      if (query.isActive === "true" || query.isActive === "false")
        filters.is_active = { $eq: query.isActive === "true" };
      if (query.search?.trim()) {
        const like = `%${escapeLikePattern(query.search.trim())}%`;
        filters.$or = [{ code: { $ilike: like } }, { name: { $ilike: like } }];
      }
      return filters;
    },
  },
  actions: {
    create: {
      commandId: "wms.sites.create",
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations();
        return localizeSiteValidationResult(
          () => parseScopedCommandInput(siteCreateSchema, raw ?? {}, ctx, translate),
          translate,
        );
      },
      response: ({ result }) => ({ id: result?.siteId ?? null }),
      status: 201,
    },
    update: {
      commandId: "wms.sites.update",
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations();
        return localizeSiteValidationResult(
          () => parseScopedCommandInput(siteUpdateSchema, raw ?? {}, ctx, translate),
          translate,
        );
      },
      response: () => ({ ok: true }),
    },
  },
});
export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;

const itemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  code: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  isActive: z.boolean().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  customValues: z.record(z.string(), z.unknown()).nullable().optional(),
  customFields: z.array(z.unknown()).optional(),
});
const siteCreateOpenApiSchema = siteCreateSchema.omit({
  organizationId: true,
  tenantId: true,
});
export const openApi = createWmsCrudOpenApi({
  resourceName: "Site",
  pluralName: "Sites",
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
  create: {
    schema: siteCreateOpenApiSchema,
    description: "Creates an active-by-default WMS site.",
  },
  update: {
    schema: siteUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: "Updates or activates a WMS site.",
  },
});
