import type {
  CommandHandler,
  CommandRuntimeContext,
} from "@open-mercato/shared/lib/commands";
import { registerCommand } from "@open-mercato/shared/lib/commands";
import {
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  setCustomFieldsIfAny,
} from "@open-mercato/shared/lib/commands/helpers";
import { splitCustomFieldPayload } from "@open-mercato/shared/lib/crud/custom-fields";
import {
  buildCustomFieldResetMap,
  loadCustomFieldSnapshot,
} from "@open-mercato/shared/lib/commands/customFieldSnapshots";
import { withAtomicFlush } from "@open-mercato/shared/lib/commands/flush";
import { extractUndoPayload } from "@open-mercato/shared/lib/commands/undo";
import { assertOptimisticLock } from "@open-mercato/shared/lib/crud/optimistic-lock-command";
import { LockMode } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import { E } from "#generated/entities.ids.generated";
import {
  CrudHttpError,
  isUniqueViolation,
} from "@open-mercato/shared/lib/crud/errors";
import { resolveTranslations } from "@open-mercato/shared/lib/i18n/server";
import type { DataEngine } from "@open-mercato/shared/lib/data/engine";
import {
  findOneWithDecryption,
  findWithDecryption,
} from "@open-mercato/shared/lib/encryption/find";
import {
  Site,
  SiteWarehouseRole,
  Warehouse,
  type SiteWarehouseRoleType,
} from "../data/entities";
import {
  siteCreateSchema,
  siteUpdateSchema,
  siteWarehouseRoleCreateSchema,
  siteWarehouseRoleUpdateSchema,
  type SiteCreateInput,
  type SiteUpdateInput,
  type SiteWarehouseRoleCreateInput,
  type SiteWarehouseRoleUpdateInput,
} from "../data/validators";
import {
  ensureOrganizationScope,
  ensureTenantScope,
  siteCrudIndexer,
  siteWarehouseRoleCrudIndexer,
} from "./shared";
import { emitWmsEvent } from "../events";
import type { z } from "zod";

type Scope = { tenantId: string; organizationId: string };
type SiteSnapshot = {
  id: string;
  tenantId: string;
  organizationId: string;
  code: string;
  name: string;
  isActive: boolean;
  updatedAt: string;
  custom?: Record<string, unknown>;
};
type RoleSnapshot = {
  id: string;
  tenantId: string;
  organizationId: string;
  siteId: string;
  warehouseId: string;
  role: SiteWarehouseRoleType;
  isDefault: boolean;
  updatedAt: string;
};
type RoleAfterSnapshot = RoleSnapshot & {
  siblingVersions?: RoleSnapshot[];
};
type RoleUndoSnapshot = {
  before?: RoleSnapshot;
  after?: RoleAfterSnapshot;
  demotedDefaults?: RoleSnapshot[];
};
type RoleExecutionAfterSnapshot = RoleAfterSnapshot & {
  demotedDefaults: RoleSnapshot[];
};

const SITE_CODE_UNIQUE_CONSTRAINT = "wms_sites_org_code_unique_idx";
const SITE_WAREHOUSE_ROLE_UNIQUE_CONSTRAINT =
  "wms_site_warehouse_roles_unique_idx";
const SITE_WAREHOUSE_ROLE_DEFAULT_UNIQUE_CONSTRAINT =
  "wms_site_warehouse_roles_default_unique_idx";
const WAREHOUSE_LOCK_SET_CHANGED = Symbol("wms.warehouseLockSetChanged");

type WarehouseLockSetChanged = {
  marker: typeof WAREHOUSE_LOCK_SET_CHANGED;
};

function isWarehouseLockSetChanged(error: unknown): error is WarehouseLockSetChanged {
  return isRecord(error) && error.marker === WAREHOUSE_LOCK_SET_CHANGED;
}

function assertSnapshotVersion(
  resourceKind: "wms.site" | "wms.siteWarehouseRole",
  record: Site | SiteWarehouseRole,
  expected: SiteSnapshot | RoleSnapshot | undefined,
) {
  assertOptimisticLock({
    resourceKind,
    resourceId: record.id,
    expected: expected?.updatedAt,
    current: record.updatedAt,
  });
}

async function rethrowSiteConstraintConflict(error: unknown): Promise<never> {
  const { translate } = await resolveTranslations();
  if (isUniqueViolation(error, SITE_CODE_UNIQUE_CONSTRAINT)) {
    const message = translate(
      "wms.sites.errors.duplicateCode",
      "Site code already exists.",
    );
    throw new CrudHttpError(409, { error: message, fieldErrors: { code: message } });
  }
  if (isUniqueViolation(error, SITE_WAREHOUSE_ROLE_UNIQUE_CONSTRAINT)) {
    const message = translate(
      "wms.sites.roles.errors.duplicateWarehouse",
      "Warehouse is already assigned to this site role.",
    );
    throw new CrudHttpError(409, {
      error: message,
      fieldErrors: { warehouseId: message },
    });
  }
  if (isUniqueViolation(error, SITE_WAREHOUSE_ROLE_DEFAULT_UNIQUE_CONSTRAINT)) {
    const message = translate(
      "wms.sites.roles.errors.defaultConflict",
      "Another warehouse was just set as default for this role. Please retry.",
    );
    throw new CrudHttpError(409, {
      error: message,
      fieldErrors: { isDefault: message },
    });
  }
  throw error;
}

async function throwRoleInvariantConflict(
  key: string,
  fallback: string,
  field?: "warehouseId" | "isDefault",
): Promise<never> {
  const { translate } = await resolveTranslations();
  const message = translate(key, fallback);
  throw new CrudHttpError(409, {
    error: message,
    ...(field ? { fieldErrors: { [field]: message } } : {}),
  });
}

async function throwSiteError(
  status: number,
  key: string,
  fallback: string,
  field?: "code" | "warehouseId" | "isDefault",
): Promise<never> {
  const { translate } = await resolveTranslations();
  const message = translate(key, fallback);
  throw new CrudHttpError(status, {
    error: message,
    ...(field ? { fieldErrors: { [field]: message } } : {}),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSiteInput<TSchema extends z.ZodTypeAny>(schema: TSchema, input: unknown) {
  const { base, custom } = splitCustomFieldPayload(input);
  const explicitCustomFields = isRecord(base.customFields)
    ? base.customFields
    : {};
  const mergedCustomFields = { ...explicitCustomFields, ...custom };
  return {
    parsed: schema.parse({ ...base, customFields: mergedCustomFields }),
    custom: mergedCustomFields,
  };
}

function scope(ctx: CommandRuntimeContext, fallback?: Partial<Scope>): Scope {
  const tenantId = fallback?.tenantId ?? ctx.auth?.tenantId;
  const organizationId =
    fallback?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId;
  if (!tenantId || !organizationId)
    throw new CrudHttpError(400, { error: "Organization scope is required." });
  return { tenantId, organizationId };
}

function em(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve("em") as EntityManager).fork();
}

async function runInTransaction<TResult>(
  manager: EntityManager,
  operation: (transaction: EntityManager) => Promise<TResult>,
): Promise<TResult> {
  const transactionalManager = manager as EntityManager & {
    transactional?: (
      callback: (transaction: EntityManager) => Promise<TResult>,
    ) => Promise<TResult>;
  };
  return typeof transactionalManager.transactional === "function"
    ? transactionalManager.transactional((transaction) =>
        operation(transaction),
      )
    : operation(manager);
}

function siteId(value: Site | string): string {
  return typeof value === "string" ? value : value.id;
}
function warehouseId(value: Warehouse | string): string {
  return typeof value === "string" ? value : value.id;
}

async function loadSite(
  manager: EntityManager,
  ctx: CommandRuntimeContext,
  id: string,
  lock = false,
): Promise<Site> {
  const currentScope = scope(ctx);
  const record = await findOneWithDecryption(
    manager,
    Site,
    {
      id,
      tenantId: currentScope.tenantId,
      organizationId: currentScope.organizationId,
      deletedAt: null,
    },
    lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
    currentScope,
  );
  if (!record)
    return throwSiteError(
      404,
      "wms.sites.errors.notFound",
      "Site not found.",
    );
  ensureTenantScope(ctx, record.tenantId);
  ensureOrganizationScope(ctx, record.organizationId);
  return record;
}

async function loadRole(
  manager: EntityManager,
  ctx: CommandRuntimeContext,
  id: string,
  lock = false,
): Promise<SiteWarehouseRole> {
  const currentScope = scope(ctx);
  const record = await findOneWithDecryption(
    manager,
    SiteWarehouseRole,
    {
      id,
      tenantId: currentScope.tenantId,
      organizationId: currentScope.organizationId,
      deletedAt: null,
    },
    lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
    currentScope,
  );
  if (!record)
    return throwSiteError(
      404,
      "wms.sites.roles.errors.notFound",
      "Site warehouse role not found.",
    );
  ensureTenantScope(ctx, record.tenantId);
  ensureOrganizationScope(ctx, record.organizationId);
  return record;
}

async function loadRoleIncludingDeleted(
  manager: EntityManager,
  ctx: CommandRuntimeContext,
  id: string,
  lock = false,
): Promise<SiteWarehouseRole> {
  const currentScope = scope(ctx);
  const record = await findOneWithDecryption(
    manager,
    SiteWarehouseRole,
    {
      id,
      tenantId: currentScope.tenantId,
      organizationId: currentScope.organizationId,
    },
    lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
    currentScope,
  );
  if (!record)
    return throwSiteError(
      404,
      "wms.sites.roles.errors.notFound",
      "Site warehouse role not found.",
    );
  ensureTenantScope(ctx, record.tenantId);
  ensureOrganizationScope(ctx, record.organizationId);
  return record;
}

async function loadWarehouse(
  manager: EntityManager,
  ctx: CommandRuntimeContext,
  id: string,
  lock = false,
): Promise<Warehouse> {
  const currentScope = scope(ctx);
  const record = await findOneWithDecryption(
    manager,
    Warehouse,
    {
      id,
      tenantId: currentScope.tenantId,
      organizationId: currentScope.organizationId,
      deletedAt: null,
    },
    lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
    currentScope,
  );
  if (!record)
    return throwSiteError(
      404,
      "wms.sites.errors.warehouseNotFound",
      "Warehouse not found.",
    );
  ensureTenantScope(ctx, record.tenantId);
  ensureOrganizationScope(ctx, record.organizationId);
  return record;
}

async function ensureCodeUnique(
  manager: EntityManager,
  current: Scope,
  code: string,
  except?: string,
) {
  const existing = await manager.findOne(Site, {
    tenantId: current.tenantId,
    organizationId: current.organizationId,
    code: { $ilike: code },
    deletedAt: null,
  });
  if (existing && existing.id !== except)
    await throwSiteError(
      409,
      "wms.sites.errors.duplicateCode",
      "Site code already exists.",
      "code",
    );
}

async function lockWarehousesInOrder(
  manager: EntityManager,
  currentSite: Scope,
  warehouseIds: string[],
): Promise<Warehouse[]> {
  const ids = [...new Set(warehouseIds)].sort((left, right) =>
    left.localeCompare(right),
  );
  if (ids.length === 0) return [];
  return findWithDecryption(
    manager,
    Warehouse,
    {
      tenantId: currentSite.tenantId,
      organizationId: currentSite.organizationId,
      id: { $in: ids },
    },
    {
      lockMode: LockMode.PESSIMISTIC_WRITE,
      orderBy: { id: "asc" },
    },
    {
      tenantId: currentSite.tenantId,
      organizationId: currentSite.organizationId,
    },
  );
}

async function runWithSiteWarehouseLocks<TResult>(
  manager: EntityManager,
  ctx: CommandRuntimeContext,
  targetSiteId: string,
  extraWarehouseIds: string[],
  operation: (input: {
    manager: EntityManager;
    site: Site;
    assignments: SiteWarehouseRole[];
    lockedWarehouses: Map<string, Warehouse>;
  }) => Promise<TResult>,
): Promise<TResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await runInTransaction(manager, async (transaction) => {
        const siteProbe = await loadSite(transaction, ctx, targetSiteId);
        const assignmentProbe = await transaction.find(SiteWarehouseRole, {
          site: siteProbe,
          deletedAt: null,
        });
        const warehouseIds = [
          ...assignmentProbe.map((item) => warehouseId(item.warehouse)),
          ...extraWarehouseIds,
        ];
        const warehouses = await lockWarehousesInOrder(
          transaction,
          siteProbe,
          warehouseIds,
        );
        const lockedWarehouses = new Map(
          warehouses.map((warehouse) => [warehouse.id, warehouse]),
        );
        const site = await loadSite(transaction, ctx, targetSiteId, true);
        const assignments = await transaction.find(
          SiteWarehouseRole,
          { site, deletedAt: null },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        const currentWarehouseIds = [
          ...assignments.map((item) => warehouseId(item.warehouse)),
          ...extraWarehouseIds,
        ];
        const missingExplicitWarehouse = extraWarehouseIds.some(
          (id) => !lockedWarehouses.has(id),
        );
        if (missingExplicitWarehouse)
          return throwSiteError(
            404,
            "wms.sites.errors.warehouseNotFound",
            "Warehouse not found.",
          );
        if (currentWarehouseIds.some((id) => !lockedWarehouses.has(id))) {
          throw { marker: WAREHOUSE_LOCK_SET_CHANGED } satisfies WarehouseLockSetChanged;
        }
        return operation({
          manager: transaction,
          site,
          assignments,
          lockedWarehouses,
        });
      });
    } catch (error) {
      if (!isWarehouseLockSetChanged(error) || attempt === 2) throw error;
    }
  }
  throw new Error("[internal] Warehouse lock retry exhausted.");
}

async function ensureActiveSiteWarehouseExclusiveAfterLocks(
  manager: EntityManager,
  currentSite: Site,
  lockedWarehouses: Map<string, Warehouse>,
  warehouseIds: string[],
  enforceExclusivity = currentSite.isActive,
  requireActiveWarehouseIds: string[] = [],
) {
  if (
    requireActiveWarehouseIds.some(
      (id) => lockedWarehouses.get(id)?.isActive !== true,
    )
  )
    await throwSiteError(
      422,
      "wms.sites.errors.warehouseMustBeActive",
      "Warehouse must be active.",
      "warehouseId",
    );
  if (!enforceExclusivity || warehouseIds.length === 0) return;
  const rows = await manager.find(
    SiteWarehouseRole,
    {
      tenantId: currentSite.tenantId,
      organizationId: currentSite.organizationId,
      warehouse: { $in: [...new Set(warehouseIds)] },
      deletedAt: null,
    },
    { populate: ["site"], lockMode: LockMode.PESSIMISTIC_WRITE },
  );
  if (
    rows.some(
      (row) =>
        siteId(row.site) !== currentSite.id &&
        typeof row.site !== "string" &&
        row.site.isActive,
    )
  )
    await throwSiteError(
      409,
      "wms.sites.errors.warehouseAssignedToActiveSite",
      "Warehouse is already assigned to another active site.",
    );
}

async function siteSnapshot(
  manager: EntityManager,
  record: Site,
): Promise<SiteSnapshot> {
  const custom = await loadCustomFieldSnapshot(manager, {
    entityId: E.wms.site,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  });
  return {
    id: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
    code: record.code,
    name: record.name,
    isActive: record.isActive,
    updatedAt: record.updatedAt.toISOString(),
    custom,
  };
}

function roleSnapshot(record: SiteWarehouseRole): RoleSnapshot {
  return {
    id: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
    siteId: siteId(record.site),
    warehouseId: warehouseId(record.warehouse),
    role: record.role,
    isDefault: record.isDefault,
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function roleAfterSnapshot(
  manager: EntityManager,
  ctx: CommandRuntimeContext,
  assignmentId: string,
): Promise<RoleAfterSnapshot> {
  const record = await loadRole(manager, ctx, assignmentId);
  const currentSite = await loadSite(manager, ctx, siteId(record.site));
  const siblings = await manager.find(SiteWarehouseRole, {
    site: currentSite,
    role: record.role,
    deletedAt: null,
  });
  return {
    ...roleSnapshot(record),
    siblingVersions: siblings
      .filter((item) => item.id !== record.id)
      .map(roleSnapshot),
  };
}

async function emitSite(
  ctx: CommandRuntimeContext,
  action: "created" | "updated" | "deleted",
  record: Site,
  undo = false,
) {
  const payload = {
    dataEngine: ctx.container.resolve("dataEngine") as DataEngine,
    action,
    entity: record,
    identifiers: {
      id: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
    },
    indexer: siteCrudIndexer,
  };
  if (undo) await emitCrudUndoSideEffects(payload);
  else await emitCrudSideEffects(payload);
}

async function emitRole(
  ctx: CommandRuntimeContext,
  action: "created" | "updated" | "deleted",
  record: SiteWarehouseRole,
  undo = false,
) {
  const payload = {
    dataEngine: ctx.container.resolve("dataEngine") as DataEngine,
    action,
    entity: record,
    identifiers: {
      id: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
    },
    indexer: siteWarehouseRoleCrudIndexer,
  };
  if (undo) await emitCrudUndoSideEffects(payload);
  else await emitCrudSideEffects(payload);
}

const createSite: CommandHandler<SiteCreateInput, { siteId: string }> = {
  id: "wms.sites.create",
  async execute(input, ctx) {
    const { parsed, custom } = parseSiteInput(
      siteCreateSchema,
      input ?? {},
    );
    ensureTenantScope(ctx, parsed.tenantId);
    ensureOrganizationScope(ctx, parsed.organizationId);
    const manager = em(ctx);
    const code = parsed.code.trim().toUpperCase();
    await ensureCodeUnique(manager, parsed, code);
    const record = manager.create(Site, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      code,
      name: parsed.name.trim(),
      isActive: parsed.isActive,
    });
    try {
      await withAtomicFlush(
        manager,
        [
          () => {
            manager.persist(record);
          },
        ],
        { transaction: true, label: "wms.sites.create" },
      );
    } catch (error) {
      await rethrowSiteConstraintConflict(error);
    }
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve("dataEngine"),
      entityId: E.wms.site,
      recordId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      values: custom,
    });
    await emitSite(ctx, "created", record);
    void emitWmsEvent("wms.site.created", {
      id: record.id,
      siteId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      code: record.code,
      name: record.name,
      isActive: record.isActive,
    });
    return { siteId: record.id };
  },
  captureAfter: async (_input, result, ctx) =>
    siteSnapshot(em(ctx), await loadSite(em(ctx), ctx, result.siteId)),
  buildLog: async ({ snapshots }) => ({
    resourceKind: "wms.site",
    snapshotAfter: snapshots?.after,
    payload: { undo: { after: snapshots?.after } },
  }),
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<{ after?: SiteSnapshot }>(logEntry)?.after;
    if (!after) return;
    const record = await runWithSiteWarehouseLocks(
      em(ctx),
      ctx,
      after.id,
      [],
      async ({ manager, site }) => {
        assertSnapshotVersion("wms.site", site, after);
        await withAtomicFlush(
          manager,
          [() => {
            site.isActive = false;
            site.updatedAt = new Date();
          }],
          { transaction: true, label: "wms.sites.create.undo" },
        );
        return site;
      },
    );
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve("dataEngine"),
      entityId: E.wms.site,
      recordId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      values: buildCustomFieldResetMap(undefined, after.custom),
    });
    await emitSite(ctx, "updated", record, true);
  },
};

const updateSite: CommandHandler<SiteUpdateInput, { siteId: string }> = {
  id: "wms.sites.update",
  prepare: async (input, ctx) => {
    const manager = em(ctx);
    return {
      before: await siteSnapshot(
        manager,
        await loadSite(manager, ctx, input.id),
      ),
    };
  },
  async execute(input, ctx) {
    const { parsed, custom } = parseSiteInput(
      siteUpdateSchema,
      input ?? {},
    );
    let record!: Site;
    let previous!: Pick<SiteSnapshot, "code" | "name" | "isActive">;
    try {
      record = await runWithSiteWarehouseLocks(
        em(ctx),
        ctx,
        parsed.id,
        [],
        async ({ manager, site: current, assignments, lockedWarehouses }) => {
      previous = {
        code: current.code,
        name: current.name,
        isActive: current.isActive,
      };
      const nextCode =
        parsed.code === undefined
          ? current.code
          : parsed.code.trim().toUpperCase();
      if (nextCode !== current.code)
        await ensureCodeUnique(manager, current, nextCode, current.id);
      const nextActive = parsed.isActive ?? current.isActive;
      const assignmentWarehouseIds = assignments.map((item) =>
        warehouseId(item.warehouse),
      );
      await ensureActiveSiteWarehouseExclusiveAfterLocks(
        manager,
        current,
        lockedWarehouses,
        assignmentWarehouseIds,
        nextActive,
      );
      await withAtomicFlush(
        manager,
        [
          () => {
            current.code = nextCode;
            if (parsed.name !== undefined) current.name = parsed.name.trim();
            current.isActive = nextActive;
            current.updatedAt = new Date();
          },
        ],
        { transaction: true, label: "wms.sites.update" },
      );
          return current;
        },
      );
    } catch (error) {
      await rethrowSiteConstraintConflict(error);
    }
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve("dataEngine"),
      entityId: E.wms.site,
      recordId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      values: custom,
    });
    await emitSite(ctx, "updated", record);
    void emitWmsEvent("wms.site.updated", {
      id: record.id,
      siteId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      code: record.code,
      name: record.name,
      isActive: record.isActive,
      previous,
    });
    return { siteId: record.id };
  },
  captureAfter: async (_input, result, ctx) =>
    siteSnapshot(em(ctx), await loadSite(em(ctx), ctx, result.siteId)),
  buildLog: async ({ snapshots }) => ({
    resourceKind: "wms.site",
    snapshotBefore: snapshots?.before,
    snapshotAfter: snapshots?.after,
    payload: { undo: snapshots },
  }),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{
      before?: SiteSnapshot;
      after?: SiteSnapshot;
    }>(logEntry);
    const before = payload?.before;
    if (!before) return;
    const record = await runWithSiteWarehouseLocks(
      em(ctx),
      ctx,
      before.id,
      [],
      async ({ manager, site: current, assignments, lockedWarehouses }) => {
      assertSnapshotVersion("wms.site", current, payload?.after);
      await ensureCodeUnique(manager, current, before.code, current.id);
      const assignmentWarehouseIds = assignments.map((item) =>
        warehouseId(item.warehouse),
      );
      await ensureActiveSiteWarehouseExclusiveAfterLocks(
        manager,
        current,
        lockedWarehouses,
        assignmentWarehouseIds,
        before.isActive,
      );
      await withAtomicFlush(
        manager,
        [() => {
          current.code = before.code;
          current.name = before.name;
          current.isActive = before.isActive;
          current.updatedAt = new Date();
        }],
        { transaction: true, label: "wms.sites.update.undo" },
      );
      return current;
      },
    );
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve("dataEngine"),
      entityId: E.wms.site,
      recordId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      values: buildCustomFieldResetMap(before.custom, payload?.after?.custom),
    });
    await emitSite(ctx, "updated", record, true);
  },
};

const createRole: CommandHandler<
  SiteWarehouseRoleCreateInput,
  { assignmentId: string; demotedDefaults: RoleSnapshot[] }
> = {
  id: "wms.site-warehouse-roles.create",
  prepare: async (input) => {
    siteWarehouseRoleCreateSchema.parse(input);
    return {};
  },
  async execute(input, ctx) {
    const parsed = siteWarehouseRoleCreateSchema.parse(input);
    ensureTenantScope(ctx, parsed.tenantId);
    ensureOrganizationScope(ctx, parsed.organizationId);
    let result!: {
      site: Site;
      record: SiteWarehouseRole;
      demotedDefaults: RoleSnapshot[];
    };
    try {
      result = await runWithSiteWarehouseLocks(
        em(ctx),
        ctx,
        parsed.siteId,
        [parsed.warehouseId],
        async ({ manager, site: currentSite, assignments, lockedWarehouses }) => {
        const warehouse = lockedWarehouses.get(parsed.warehouseId);
        if (!warehouse || warehouse.deletedAt)
          return throwSiteError(
            404,
            "wms.sites.errors.warehouseNotFound",
            "Warehouse not found.",
          );
        const siblings = assignments.filter((item) => item.role === parsed.role);
        if (
          siblings.some((item) => warehouseId(item.warehouse) === warehouse.id)
        )
          await throwSiteError(
            409,
            "wms.sites.roles.errors.duplicateWarehouse",
            "Warehouse is already assigned to this site role.",
            "warehouseId",
          );
        await ensureActiveSiteWarehouseExclusiveAfterLocks(
          manager,
          currentSite,
          lockedWarehouses,
          [warehouse.id],
          currentSite.isActive,
          [warehouse.id],
        );
        const currentRecord = manager.create(SiteWarehouseRole, {
          tenantId: currentSite.tenantId,
          organizationId: currentSite.organizationId,
          site: currentSite,
          warehouse,
          role: parsed.role,
          isDefault: false,
        });
        const promote = parsed.isDefault === true || siblings.length === 0;
        const demotedDefaults = promote
          ? siblings.filter((item) => item.isDefault).map(roleSnapshot)
          : [];
        await withAtomicFlush(
          manager,
          [
            () => manager.persist(currentRecord),
            () => {
              if (promote) for (const item of siblings) item.isDefault = false;
            },
            () => {
              currentRecord.isDefault = promote;
            },
          ],
          { transaction: true, label: "wms.site-warehouse-roles.create" },
        );
        return {
          site: currentSite,
          record: currentRecord,
          demotedDefaults,
        };
        },
      );
    } catch (error) {
      await rethrowSiteConstraintConflict(error);
    }
    const { site, record } = result;
    await emitRole(ctx, "created", record);
    void emitWmsEvent("wms.site_warehouse_role.created", {
      id: record.id,
      mappingId: record.id,
      siteId: site.id,
      tenantId: site.tenantId,
      organizationId: site.organizationId,
      warehouseId: warehouseId(record.warehouse),
      role: record.role,
      isDefault: record.isDefault,
    });
    return { assignmentId: record.id, demotedDefaults: result.demotedDefaults };
  },
  captureAfter: async (_input, result, ctx) => ({
    ...(await roleAfterSnapshot(em(ctx), ctx, result.assignmentId)),
    demotedDefaults: result.demotedDefaults,
  }),
  buildLog: async ({ snapshots }) => {
    const executionAfter = snapshots?.after as
      | RoleExecutionAfterSnapshot
      | undefined;
    const { demotedDefaults = [], ...after } = executionAfter ?? {};
    return {
      resourceKind: "wms.siteWarehouseRole",
      snapshotAfter: executionAfter ? after : undefined,
      payload: {
        undo: {
          after: executionAfter ? after : undefined,
          demotedDefaults,
        },
      },
    };
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<RoleUndoSnapshot>(logEntry);
    const after = payload?.after;
    if (!after) return;
    let record!: SiteWarehouseRole;
    try {
      record = await runWithSiteWarehouseLocks(
        em(ctx),
        ctx,
        after.siteId,
        [after.warehouseId],
        async ({ manager, site: currentSite, assignments, lockedWarehouses }) => {
      const currentRecord = assignments.find((item) => item.id === after.id);
      if (!currentRecord)
        return throwSiteError(
          404,
          "wms.sites.roles.errors.notFound",
          "Site warehouse role not found.",
        );
      assertSnapshotVersion("wms.siteWarehouseRole", currentRecord, after);
      await ensureActiveSiteWarehouseExclusiveAfterLocks(
        manager,
        currentSite,
        lockedWarehouses,
        [warehouseId(currentRecord.warehouse)],
      );
      const siblings = assignments.filter(
        (item) => item.role === currentRecord.role,
      );
      const replacement = siblings.find((item) =>
        payload?.demotedDefaults?.some(
          (snapshot) => snapshot.id === item.id && snapshot.isDefault,
        ),
      );
      if (currentRecord.isDefault && siblings.length > 1 && !replacement)
        await throwRoleInvariantConflict(
          "wms.sites.roles.errors.defaultInvariant",
          "A default warehouse is required while mappings remain.",
          "isDefault",
        );
      if (replacement) {
        assertSnapshotVersion(
          "wms.siteWarehouseRole",
          replacement,
          after.siblingVersions?.find((snapshot) => snapshot.id === replacement.id),
        );
      }
      const undoPhases = [
        () => {
          currentRecord.isDefault = false;
        },
      ];
      if (replacement) {
        undoPhases.push(() => {
          replacement.isDefault = true;
          replacement.updatedAt = new Date();
        });
      }
      undoPhases.push(() => {
        currentRecord.deletedAt = new Date();
        currentRecord.updatedAt = new Date();
      });
      await withAtomicFlush(
        manager,
        undoPhases,
        { transaction: true, label: "wms.site-warehouse-roles.create.undo" },
      );
      return currentRecord;
        },
      );
    } catch (error) {
      await rethrowSiteConstraintConflict(error);
    }
    await emitRole(ctx, "deleted", record, true);
  },
};

const updateRole: CommandHandler<
  SiteWarehouseRoleUpdateInput,
  { assignmentId: string; demotedDefaults: RoleSnapshot[] }
> = {
  id: "wms.site-warehouse-roles.update",
  prepare: async (input, ctx) => {
    const manager = em(ctx);
    const record = await loadRole(manager, ctx, input.id);
    return {
      before: roleSnapshot(record),
    };
  },
  async execute(input, ctx) {
    const parsed = siteWarehouseRoleUpdateSchema.parse(input);
    const initialManager = em(ctx);
    const initialRecord = await loadRole(initialManager, ctx, parsed.id);
    const initialSnapshot = roleSnapshot(initialRecord);
    const nextWarehouseId = parsed.warehouseId ?? initialSnapshot.warehouseId;
    let result!: {
      site: Site;
      record: SiteWarehouseRole;
      demotedDefaults: RoleSnapshot[];
    };
    let previous!: RoleSnapshot;
    try {
      result = await runWithSiteWarehouseLocks(
        initialManager,
        ctx,
        initialSnapshot.siteId,
        [initialSnapshot.warehouseId, nextWarehouseId],
        async ({ manager, site: currentSite, assignments, lockedWarehouses }) => {
        const currentRecord = assignments.find((item) => item.id === parsed.id);
        if (!currentRecord)
          return throwSiteError(
            404,
            "wms.sites.roles.errors.notFound",
            "Site warehouse role not found.",
          );
        assertSnapshotVersion(
          "wms.siteWarehouseRole",
          currentRecord,
          initialSnapshot,
        );
        previous = roleSnapshot(currentRecord);
        const nextWarehouse = lockedWarehouses.get(nextWarehouseId);
        if (!nextWarehouse || nextWarehouse.deletedAt)
          return throwSiteError(
            404,
            "wms.sites.errors.warehouseNotFound",
            "Warehouse not found.",
          );
        await ensureActiveSiteWarehouseExclusiveAfterLocks(
          manager,
          currentSite,
          lockedWarehouses,
          [nextWarehouse.id],
          currentSite.isActive,
          [nextWarehouse.id],
        );
        const siblings = assignments.filter(
          (item) => item.role === currentRecord.role,
        );
        if (
          parsed.warehouseId &&
          siblings.some(
            (item) =>
              item.id !== currentRecord.id &&
              warehouseId(item.warehouse) === nextWarehouse.id,
          )
        )
          await throwSiteError(
            409,
            "wms.sites.roles.errors.duplicateWarehouse",
            "Warehouse is already assigned to this site role.",
            "warehouseId",
          );
        if (parsed.isDefault === false && currentRecord.isDefault)
          await throwSiteError(
            409,
            "wms.sites.roles.errors.defaultRemoval",
            "Promote a replacement before removing the default.",
            "isDefault",
          );
        const demotedDefaults =
          parsed.isDefault === true
            ? siblings
                .filter(
                  (item) => item.id !== currentRecord.id && item.isDefault,
                )
                .map(roleSnapshot)
            : [];
        const updatePhases = [
          () => {
            currentRecord.warehouse = nextWarehouse;
            if (parsed.isDefault !== undefined) currentRecord.isDefault = false;
            currentRecord.updatedAt = new Date();
          },
        ];
        if (parsed.isDefault === true) {
          updatePhases.push(
            () => {
              for (const item of siblings) item.isDefault = false;
            },
            () => {
              currentRecord.isDefault = true;
            },
          );
        }
        await withAtomicFlush(manager, updatePhases, {
          transaction: true,
          label: "wms.site-warehouse-roles.update",
        });
        return {
          site: currentSite,
          record: currentRecord,
          demotedDefaults,
        };
        },
      );
    } catch (error) {
      await rethrowSiteConstraintConflict(error);
    }
    const { site, record } = result;
    await emitRole(ctx, "updated", record);
    void emitWmsEvent("wms.site_warehouse_role.updated", {
      id: record.id,
      mappingId: record.id,
      siteId: site.id,
      tenantId: site.tenantId,
      organizationId: site.organizationId,
      warehouseId: warehouseId(record.warehouse),
      role: record.role,
      isDefault: record.isDefault,
      previous,
    });
    return { assignmentId: record.id, demotedDefaults: result.demotedDefaults };
  },
  captureAfter: async (_input, result, ctx) => ({
    ...(await roleAfterSnapshot(em(ctx), ctx, result.assignmentId)),
    demotedDefaults: result.demotedDefaults,
  }),
  buildLog: async ({ snapshots }) => {
    const executionAfter = snapshots?.after as
      | RoleExecutionAfterSnapshot
      | undefined;
    const { demotedDefaults = [], ...after } = executionAfter ?? {};
    return {
      resourceKind: "wms.siteWarehouseRole",
      snapshotBefore: snapshots?.before,
      snapshotAfter: executionAfter ? after : undefined,
      payload: {
        undo: {
          before: snapshots?.before,
          after: executionAfter ? after : undefined,
          demotedDefaults,
        },
      },
    };
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<RoleUndoSnapshot>(logEntry);
    const before = payload?.before;
    if (!before) return;
    let record!: SiteWarehouseRole;
    try {
      record = await runWithSiteWarehouseLocks(
        em(ctx),
        ctx,
        before.siteId,
        [before.warehouseId, ...(payload?.after ? [payload.after.warehouseId] : [])],
        async ({ manager, site: currentSite, assignments, lockedWarehouses }) => {
      const currentRecord = assignments.find((item) => item.id === before.id);
      if (!currentRecord)
        return throwSiteError(
          404,
          "wms.sites.roles.errors.notFound",
          "Site warehouse role not found.",
        );
      assertSnapshotVersion(
        "wms.siteWarehouseRole",
        currentRecord,
        payload?.after,
      );
      const restoredWarehouse = lockedWarehouses.get(before.warehouseId);
      if (!restoredWarehouse || restoredWarehouse.deletedAt)
        return throwSiteError(
          404,
          "wms.sites.errors.warehouseNotFound",
          "Warehouse not found.",
        );
      const siblings = assignments.filter(
        (item) => item.role === currentRecord.role,
      );
      if (
        siblings.some(
          (item) =>
            item.id !== currentRecord.id &&
            warehouseId(item.warehouse) === restoredWarehouse.id,
        )
      )
        await throwRoleInvariantConflict(
          "wms.sites.roles.errors.duplicateWarehouse",
          "Warehouse is already assigned to this site role.",
          "warehouseId",
        );
      await ensureActiveSiteWarehouseExclusiveAfterLocks(
        manager,
        currentSite,
        lockedWarehouses,
        [restoredWarehouse.id],
      );
      const siblingDefault = siblings.find(
        (item) => item.id !== currentRecord.id && item.isDefault,
      );
      const replacement =
        siblingDefault ??
        siblings.find((item) =>
          payload?.demotedDefaults?.some(
            (snapshot) => snapshot.id === item.id && snapshot.isDefault,
          ),
        );
      if (!before.isDefault && currentRecord.isDefault && !replacement)
        await throwRoleInvariantConflict(
          "wms.sites.roles.errors.defaultInvariant",
          "A default warehouse is required while mappings remain.",
          "isDefault",
        );
      const promoteReplacement =
        !before.isDefault && currentRecord.isDefault && replacement;
      if (promoteReplacement) {
        assertSnapshotVersion(
          "wms.siteWarehouseRole",
          promoteReplacement,
          payload?.after?.siblingVersions?.find(
            (snapshot) => snapshot.id === promoteReplacement.id,
          ),
        );
      }
      const undoPhases = [
        () => {
          currentRecord.warehouse = restoredWarehouse;
          currentRecord.isDefault = false;
          currentRecord.updatedAt = new Date();
        },
      ];
      if (before.isDefault) {
        undoPhases.push(
          () => {
            for (const item of siblings) {
              if (item.id !== currentRecord.id) item.isDefault = false;
            }
          },
          () => {
            currentRecord.isDefault = true;
          },
        );
      } else if (promoteReplacement) {
        undoPhases.push(() => {
          promoteReplacement.isDefault = true;
          promoteReplacement.updatedAt = new Date();
        });
      }
      await withAtomicFlush(manager, undoPhases, {
        transaction: true,
        label: "wms.site-warehouse-roles.update.undo",
      });
      return currentRecord;
        },
      );
    } catch (error) {
      await rethrowSiteConstraintConflict(error);
    }
    await emitRole(ctx, "updated", record, true);
  },
};

const deleteRole: CommandHandler<{ id: string }, { assignmentId: string }> = {
  id: "wms.site-warehouse-roles.delete",
  prepare: async (input, ctx) => ({
    before: roleSnapshot(await loadRole(em(ctx), ctx, input.id)),
  }),
  async execute(input, ctx) {
    const initialManager = em(ctx);
    const initialRecord = await loadRole(initialManager, ctx, input.id);
    const initialSnapshot = roleSnapshot(initialRecord);
    const { site, record } = await runWithSiteWarehouseLocks(
      initialManager,
      ctx,
      initialSnapshot.siteId,
      [initialSnapshot.warehouseId],
      async ({ manager, site: currentSite, assignments, lockedWarehouses }) => {
        const currentRecord = assignments.find((item) => item.id === input.id);
        if (!currentRecord)
          return throwSiteError(
            404,
            "wms.sites.roles.errors.notFound",
            "Site warehouse role not found.",
          );
        assertSnapshotVersion(
          "wms.siteWarehouseRole",
          currentRecord,
          initialSnapshot,
        );
        await ensureActiveSiteWarehouseExclusiveAfterLocks(
          manager,
          currentSite,
          lockedWarehouses,
          [warehouseId(currentRecord.warehouse)],
        );
        const siblings = assignments.filter(
          (item) => item.role === currentRecord.role,
        );
        if (currentRecord.isDefault && siblings.length > 1)
          await throwSiteError(
            409,
            "wms.sites.roles.errors.defaultDeletion",
            "Promote a replacement before deleting the default.",
            "isDefault",
          );
        await withAtomicFlush(
          manager,
          [
            () => {
              currentRecord.deletedAt = new Date();
              currentRecord.updatedAt = new Date();
            },
          ],
          { transaction: true, label: "wms.site-warehouse-roles.delete" },
        );
        return { site: currentSite, record: currentRecord };
      },
    );
    await emitRole(ctx, "deleted", record);
    void emitWmsEvent("wms.site_warehouse_role.deleted", {
      id: record.id,
      mappingId: record.id,
      siteId: site.id,
      tenantId: site.tenantId,
      organizationId: site.organizationId,
      warehouseId: warehouseId(record.warehouse),
      role: record.role,
      isDefault: record.isDefault,
    });
    return { assignmentId: record.id };
  },
  captureAfter: async (_input, result, ctx) =>
    roleSnapshot(
      await loadRoleIncludingDeleted(em(ctx), ctx, result.assignmentId),
    ),
  buildLog: async ({ snapshots }) => ({
    resourceKind: "wms.siteWarehouseRole",
    snapshotBefore: snapshots?.before,
    snapshotAfter: snapshots?.after,
    payload: { undo: snapshots },
  }),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<RoleUndoSnapshot>(logEntry);
    const before = payload?.before;
    if (!before) return;
    let record!: SiteWarehouseRole;
    try {
      record = await runWithSiteWarehouseLocks(
        em(ctx),
        ctx,
        before.siteId,
        [before.warehouseId],
        async ({ manager, site: currentSite, assignments, lockedWarehouses }) => {
      const currentRecord = await loadRoleIncludingDeleted(
        manager,
        ctx,
        before.id,
        true,
      );
      assertSnapshotVersion(
        "wms.siteWarehouseRole",
        currentRecord,
        payload?.after,
      );
      const restoredWarehouse = lockedWarehouses.get(before.warehouseId);
      if (!restoredWarehouse)
        return throwSiteError(
          404,
          "wms.sites.errors.warehouseNotFound",
          "Warehouse not found.",
        );
      const siblings = assignments.filter((item) => item.role === before.role);
      if (
        siblings.some(
          (item) => warehouseId(item.warehouse) === restoredWarehouse.id,
        )
      )
        await throwRoleInvariantConflict(
          "wms.sites.roles.errors.duplicateWarehouse",
          "Warehouse is already assigned to this site role.",
          "warehouseId",
        );
      if (before.isDefault && siblings.some((item) => item.isDefault))
        await throwRoleInvariantConflict(
          "wms.sites.roles.errors.defaultInvariant",
          "A default warehouse is required while mappings remain.",
          "isDefault",
        );
      await ensureActiveSiteWarehouseExclusiveAfterLocks(
        manager,
        currentSite,
        lockedWarehouses,
        [restoredWarehouse.id],
      );
      await withAtomicFlush(
        manager,
        [
          () => {
            currentRecord.warehouse = restoredWarehouse;
            currentRecord.isDefault = before.isDefault || siblings.length === 0;
            currentRecord.deletedAt = null;
            currentRecord.updatedAt = new Date();
          },
        ],
        { transaction: true, label: "wms.site-warehouse-roles.delete.undo" },
      );
      return currentRecord;
        },
      );
    } catch (error) {
      await rethrowSiteConstraintConflict(error);
    }
    await emitRole(ctx, "created", record, true);
  },
};

registerCommand(createSite);
registerCommand(updateSite);
registerCommand(createRole);
registerCommand(updateRole);
registerCommand(deleteRole);
