import { registerCommand } from "@open-mercato/shared/lib/commands";
import type { CommandHandler } from "@open-mercato/shared/lib/commands";
import {
  buildChanges,
  requireId,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
} from "@open-mercato/shared/lib/commands/helpers";
import type {
  CrudEventAction,
  CrudEventsConfig,
  CrudIndexerConfig,
} from "@open-mercato/shared/lib/crud/types";
import type { EntityManager } from "@mikro-orm/postgresql";
import { UniqueConstraintViolationException } from "@mikro-orm/core";
import { CrudHttpError } from "@open-mercato/shared/lib/crud/errors";
import { resolveTranslations } from "@open-mercato/shared/lib/i18n/server";
import type { DataEngine } from "@open-mercato/shared/lib/data/engine";
import { E } from "#generated/entities.ids.generated";
import {
  findOneWithDecryption,
} from "@open-mercato/shared/lib/encryption/find";
import { CatalogProduct, CatalogProductUnitConversion } from "../data/entities";
import {
  productUnitConversionCreateSchema,
  productUnitConversionUpdateSchema,
  productUnitConversionDeleteSchema,
  type ProductUnitConversionCreateInput,
  type ProductUnitConversionUpdateInput,
  type ProductUnitConversionDeleteInput,
} from "../data/validators";
import {
  ensureOrganizationScope,
  ensureSameScope,
  cloneJson,
  ensureTenantScope,
  extractUndoPayload,
  requireProduct,
  toNumericString,
  getErrorConstraint,
  getErrorMessage,
} from "./shared";
import { toUnitLookupKey } from "../lib/unitCodes";
import { resolveCanonicalUnitCode } from "../lib/unitResolution";

type ProductUnitConversionSnapshot = {
  id: string;
  productId: string;
  organizationId: string;
  tenantId: string;
  unitCode: string;
  toBaseFactor: string;
  sortOrder: number;
  isActive: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

type ProductUnitConversionUndoPayload = {
  before?: ProductUnitConversionSnapshot | null;
  after?: ProductUnitConversionSnapshot | null;
};

const conversionCrudEvents: CrudEventsConfig<CatalogProductUnitConversion> = {
  module: "catalog",
  entity: "product_unit_conversion",
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    productId:
      ctx.entity.product && typeof ctx.entity.product !== "string"
        ? ctx.entity.product.id
        : null,
    unitCode: ctx.entity.unitCode,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
};

const conversionCrudIndexer: CrudIndexerConfig<CatalogProductUnitConversion> = {
  entityType: E.catalog.catalog_product_unit_conversion,
  buildUpsertPayload: (ctx) => ({
    entityType: E.catalog.catalog_product_unit_conversion,
    recordId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
  buildDeletePayload: (ctx) => ({
    entityType: E.catalog.catalog_product_unit_conversion,
    recordId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
};

function buildIdentifiers(record: CatalogProductUnitConversion) {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
  };
}

async function emitConversionCrudChange(opts: {
  dataEngine: DataEngine;
  action: CrudEventAction;
  conversion: CatalogProductUnitConversion;
}) {
  const { dataEngine, action, conversion } = opts;
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: conversion,
    identifiers: buildIdentifiers(conversion),
    events: conversionCrudEvents,
    indexer: conversionCrudIndexer,
  });
}

async function emitConversionCrudUndoChange(opts: {
  dataEngine: DataEngine;
  action: CrudEventAction;
  conversion: CatalogProductUnitConversion;
}) {
  const { dataEngine, action, conversion } = opts;
  await emitCrudUndoSideEffects({
    dataEngine,
    action,
    entity: conversion,
    identifiers: buildIdentifiers(conversion),
    events: conversionCrudEvents,
    indexer: conversionCrudIndexer,
  });
}

async function loadConversionSnapshot(
  em: EntityManager,
  id: string,
): Promise<ProductUnitConversionSnapshot | null> {
  const record = await findOneWithDecryption(
    em,
    CatalogProductUnitConversion,
    { id, deletedAt: null },
    { populate: ["product"] },
  );
  if (!record) return null;
  const productId =
    typeof record.product === "string"
      ? record.product
      : (record.product?.id ?? null);
  if (!productId) return null;
  return {
    id: record.id,
    productId,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    unitCode: record.unitCode,
    toBaseFactor: record.toBaseFactor,
    sortOrder: record.sortOrder,
    isActive: record.isActive,
    metadata: record.metadata
      ? cloneJson(record.metadata)
      : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function applyConversionSnapshot(
  em: EntityManager,
  record: CatalogProductUnitConversion,
  snapshot: ProductUnitConversionSnapshot,
): void {
  record.organizationId = snapshot.organizationId;
  record.tenantId = snapshot.tenantId;
  record.product = em.getReference(CatalogProduct, snapshot.productId);
  record.unitCode = snapshot.unitCode;
  record.toBaseFactor = snapshot.toBaseFactor;
  record.sortOrder = snapshot.sortOrder;
  record.isActive = snapshot.isActive;
  record.metadata = snapshot.metadata
    ? cloneJson(snapshot.metadata)
    : null;
  record.createdAt = new Date(snapshot.createdAt);
  record.updatedAt = new Date(snapshot.updatedAt);
}

async function ensureDefaultSalesUnitIsNotRemoved(
  em: EntityManager,
  record: CatalogProductUnitConversion,
  nextIsActive: boolean,
): Promise<void> {
  if (nextIsActive) return;
  const product =
    typeof record.product === "string"
      ? await findOneWithDecryption(em, CatalogProduct, {
          id: record.product,
          deletedAt: null,
        })
      : record.product;
  if (!product) return;
  const defaultSalesUnitKey = toUnitLookupKey(product.defaultSalesUnit);
  const conversionUnitKey = toUnitLookupKey(record.unitCode);
  if (
    defaultSalesUnitKey &&
    conversionUnitKey &&
    defaultSalesUnitKey === conversionUnitKey
  ) {
    throw new CrudHttpError(409, {
      error: "uom.default_sales_unit_conversion_required",
    });
  }
}

function resolveConversionUniqueConstraint(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationException) {
    const constraint = getErrorConstraint(error);
    if (constraint === "catalog_product_unit_conversions_unique") return true;
    const message = getErrorMessage(error);
    return message.toLowerCase().includes("catalog_product_unit_conversions_unique");
  }
  return false;
}

async function rethrowConversionUniqueConstraint(
  error: unknown,
): Promise<never> {
  if (resolveConversionUniqueConstraint(error)) {
    throw new CrudHttpError(409, { error: "uom.duplicate_conversion" });
  }
  throw error;
}

const createProductUnitConversionCommand: CommandHandler<
  ProductUnitConversionCreateInput,
  { conversionId: string }
> = {
  id: "catalog.product-unit-conversions.create",
  async execute(rawInput, ctx) {
    const parsed = productUnitConversionCreateSchema.parse(rawInput);
    ensureTenantScope(ctx, parsed.tenantId);
    ensureOrganizationScope(ctx, parsed.organizationId);

    const em = (ctx.container.resolve("em") as EntityManager).fork();
    const product = await requireProduct(
      em,
      parsed.productId,
      "Catalog product not found",
    );
    ensureSameScope(product, parsed.organizationId, parsed.tenantId);
    const canonicalUnitCode = await resolveCanonicalUnitCode(em, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      unitCode: parsed.unitCode,
    });

    const toBaseFactorStr = toNumericString(parsed.toBaseFactor);
    if (!toBaseFactorStr) {
      throw new CrudHttpError(400, {
        error: "uom.conversion_factor_required",
      });
    }

    const conversion = em.create(CatalogProductUnitConversion, {
      product,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      unitCode: canonicalUnitCode,
      toBaseFactor: toBaseFactorStr,
      sortOrder: parsed.sortOrder ?? 0,
      isActive: parsed.isActive !== false,
      metadata: parsed.metadata
        ? cloneJson(parsed.metadata)
        : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(conversion);
    try {
      await em.flush();
    } catch (error) {
      await rethrowConversionUniqueConstraint(error);
    }

    const dataEngine = ctx.container.resolve("dataEngine") as DataEngine;
    await emitConversionCrudChange({
      dataEngine,
      action: "created",
      conversion,
    });
    return { conversionId: conversion.id };
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve("em") as EntityManager).fork();
    return loadConversionSnapshot(em, result.conversionId);
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as ProductUnitConversionSnapshot | undefined;
    if (!after) return null;
    const { translate } = await resolveTranslations();
    return {
      actionLabel: translate(
        "catalog.audit.productUnitConversions.create",
        "Create product unit conversion",
      ),
      resourceKind: "catalog.product_unit_conversion",
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: {
          after,
        } satisfies ProductUnitConversionUndoPayload,
      },
    };
  },
  undo: async ({ logEntry, ctx }) => {
    const payload =
      extractUndoPayload<ProductUnitConversionUndoPayload>(logEntry);
    const after = payload?.after;
    if (!after) return;
    const em = (ctx.container.resolve("em") as EntityManager).fork();
    const record = await findOneWithDecryption(
      em,
      CatalogProductUnitConversion,
      { id: after.id, deletedAt: null },
    );
    if (!record) return;
    ensureTenantScope(ctx, record.tenantId);
    ensureOrganizationScope(ctx, record.organizationId);
    em.remove(record);
    await em.flush();
    const dataEngine = ctx.container.resolve("dataEngine") as DataEngine;
    await emitConversionCrudUndoChange({
      dataEngine,
      action: "deleted",
      conversion: record,
    });
  },
};

const updateProductUnitConversionCommand: CommandHandler<
  ProductUnitConversionUpdateInput,
  { conversionId: string }
> = {
  id: "catalog.product-unit-conversions.update",
  async prepare(input, ctx) {
    const id = requireId(input, "Product unit conversion id is required");
    const em = ctx.container.resolve("em") as EntityManager;
    const snapshot = await loadConversionSnapshot(em, id);
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId);
      ensureOrganizationScope(ctx, snapshot.organizationId);
    }
    return snapshot ? { before: snapshot } : {};
  },
  async execute(rawInput, ctx) {
    const parsed = productUnitConversionUpdateSchema.parse(rawInput);
    const em = (ctx.container.resolve("em") as EntityManager).fork();
    const record = await findOneWithDecryption(
      em,
      CatalogProductUnitConversion,
      { id: parsed.id, deletedAt: null },
      { populate: ["product"] },
    );
    if (!record)
      throw new CrudHttpError(404, {
        error: "Catalog product unit conversion not found",
      });
    const product =
      typeof record.product === "string"
        ? await requireProduct(em, record.product, "Catalog product not found")
        : record.product;
    ensureTenantScope(ctx, record.tenantId);
    ensureOrganizationScope(ctx, record.organizationId);
    ensureSameScope(product, record.organizationId, record.tenantId);

    // Resolve all query-dependent values BEFORE applying scalar mutations
    const resolvedUnitCode =
      parsed.unitCode !== undefined
        ? await resolveCanonicalUnitCode(em, {
            organizationId: record.organizationId,
            tenantId: record.tenantId,
            unitCode: parsed.unitCode,
          })
        : undefined;
    if (parsed.isActive !== undefined) {
      await ensureDefaultSalesUnitIsNotRemoved(em, record, parsed.isActive);
    }

    // Apply all scalar mutations after queries are complete
    if (resolvedUnitCode !== undefined) {
      record.unitCode = resolvedUnitCode;
    }
    if (parsed.toBaseFactor !== undefined) {
      record.toBaseFactor =
        toNumericString(parsed.toBaseFactor) ?? record.toBaseFactor;
    }
    if (parsed.sortOrder !== undefined) {
      record.sortOrder = parsed.sortOrder;
    }
    if (parsed.isActive !== undefined) {
      record.isActive = parsed.isActive;
    }
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata
        ? cloneJson(parsed.metadata)
        : null;
    }
    try {
      await em.transactional(async () => {
        await em.flush();
      });
    } catch (error) {
      await rethrowConversionUniqueConstraint(error);
    }

    const dataEngine = ctx.container.resolve("dataEngine") as DataEngine;
    await emitConversionCrudChange({
      dataEngine,
      action: "updated",
      conversion: record,
    });
    return { conversionId: record.id };
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve("em") as EntityManager).fork();
    return loadConversionSnapshot(em, result.conversionId);
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as
      | ProductUnitConversionSnapshot
      | undefined;
    const after = snapshots.after as ProductUnitConversionSnapshot | undefined;
    if (!before || !after) return null;
    const { translate } = await resolveTranslations();
    return {
      actionLabel: translate(
        "catalog.audit.productUnitConversions.update",
        "Update product unit conversion",
      ),
      resourceKind: "catalog.product_unit_conversion",
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      changes: buildChanges(before, after, [
        "unitCode",
        "toBaseFactor",
        "sortOrder",
        "isActive",
        "metadata",
      ]),
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: {
          before,
          after,
        } satisfies ProductUnitConversionUndoPayload,
      },
    };
  },
  undo: async ({ logEntry, ctx }) => {
    const payload =
      extractUndoPayload<ProductUnitConversionUndoPayload>(logEntry);
    const before = payload?.before;
    if (!before) return;
    const em = (ctx.container.resolve("em") as EntityManager).fork();
    let record = await findOneWithDecryption(
      em,
      CatalogProductUnitConversion,
      { id: before.id, deletedAt: null },
    );
    let undoAction: "updated" | "created" = "updated";
    if (!record) {
      record = em.create(CatalogProductUnitConversion, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        product: em.getReference(CatalogProduct, before.productId),
        unitCode: before.unitCode,
        toBaseFactor: before.toBaseFactor,
        sortOrder: before.sortOrder,
        isActive: before.isActive,
        metadata: before.metadata
          ? cloneJson(before.metadata)
          : null,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      });
      em.persist(record);
      undoAction = "created";
    }
    ensureTenantScope(ctx, before.tenantId);
    ensureOrganizationScope(ctx, before.organizationId);
    applyConversionSnapshot(em, record, before);
    await em.transactional(async () => {
      await em.flush();
    });
    const dataEngine = ctx.container.resolve("dataEngine") as DataEngine;
    await emitConversionCrudUndoChange({
      dataEngine,
      action: undoAction,
      conversion: record,
    });
  },
};

const deleteProductUnitConversionCommand: CommandHandler<
  ProductUnitConversionDeleteInput,
  { conversionId: string }
> = {
  id: "catalog.product-unit-conversions.delete",
  async prepare(input, ctx) {
    const id = requireId(input, "Product unit conversion id is required");
    const em = ctx.container.resolve("em") as EntityManager;
    const snapshot = await loadConversionSnapshot(em, id);
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId);
      ensureOrganizationScope(ctx, snapshot.organizationId);
    }
    return snapshot ? { before: snapshot } : {};
  },
  async execute(rawInput, ctx) {
    const parsed = productUnitConversionDeleteSchema.parse(rawInput);
    const em = (ctx.container.resolve("em") as EntityManager).fork();
    const record = await findOneWithDecryption(
      em,
      CatalogProductUnitConversion,
      { id: parsed.id, deletedAt: null },
      { populate: ["product"] },
    );
    if (!record)
      throw new CrudHttpError(404, {
        error: "Catalog product unit conversion not found",
      });
    ensureTenantScope(ctx, record.tenantId);
    ensureOrganizationScope(ctx, record.organizationId);
    await ensureDefaultSalesUnitIsNotRemoved(em, record, false);

    em.remove(record);
    await em.transactional(async () => {
      await em.flush();
    });

    const dataEngine = ctx.container.resolve("dataEngine") as DataEngine;
    await emitConversionCrudChange({
      dataEngine,
      action: "deleted",
      conversion: record,
    });
    return { conversionId: parsed.id };
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as
      | ProductUnitConversionSnapshot
      | undefined;
    if (!before) return null;
    const { translate } = await resolveTranslations();
    return {
      actionLabel: translate(
        "catalog.audit.productUnitConversions.delete",
        "Delete product unit conversion",
      ),
      resourceKind: "catalog.product_unit_conversion",
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies ProductUnitConversionUndoPayload,
      },
    };
  },
  undo: async ({ logEntry, ctx }) => {
    const payload =
      extractUndoPayload<ProductUnitConversionUndoPayload>(logEntry);
    const before = payload?.before;
    if (!before) return;
    const em = (ctx.container.resolve("em") as EntityManager).fork();
    let record = await findOneWithDecryption(
      em,
      CatalogProductUnitConversion,
      { id: before.id, deletedAt: null },
    );
    if (!record) {
      record = em.create(CatalogProductUnitConversion, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        product: em.getReference(CatalogProduct, before.productId),
        unitCode: before.unitCode,
        toBaseFactor: before.toBaseFactor,
        sortOrder: before.sortOrder,
        isActive: before.isActive,
        metadata: before.metadata
          ? cloneJson(before.metadata)
          : null,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      });
      em.persist(record);
    }
    ensureTenantScope(ctx, before.tenantId);
    ensureOrganizationScope(ctx, before.organizationId);
    applyConversionSnapshot(em, record, before);
    await em.transactional(async () => {
      await em.flush();
    });
    const dataEngine = ctx.container.resolve("dataEngine") as DataEngine;
    await emitConversionCrudUndoChange({
      dataEngine,
      action: "created",
      conversion: record,
    });
  },
};

registerCommand(createProductUnitConversionCommand);
registerCommand(updateProductUnitConversionCommand);
registerCommand(deleteProductUnitConversionCommand);
