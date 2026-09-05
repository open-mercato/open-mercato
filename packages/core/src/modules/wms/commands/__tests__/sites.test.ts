/** @jest-environment node */

import { commandRegistry } from "@open-mercato/shared/lib/commands/registry";
import { Site, SiteWarehouseRole, Warehouse } from "../../data/entities";

jest.mock("@open-mercato/shared/lib/i18n/server", () => ({
  resolveTranslations: async () => ({
    locale: "en",
    dict: {},
    t: (key: string) => key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

jest.mock("../../events", () => ({
  emitWmsEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@open-mercato/shared/lib/encryption/find", () => ({
  findOneWithDecryption: (
    manager: { findOne: (...args: unknown[]) => unknown },
    entity: unknown,
    filters: unknown,
    options?: unknown,
  ) => manager.findOne(entity, filters, options),
  findWithDecryption: (
    manager: { find: (...args: unknown[]) => unknown },
    entity: unknown,
    filters: unknown,
    options?: unknown,
  ) => manager.find(entity, filters, options),
}));

const TENANT = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION = "22222222-2222-4222-8222-222222222222";
const SITE_ID = "33333333-3333-4333-8333-333333333333";
const WAREHOUSE_A_ID = "44444444-4444-4444-8444-444444444444";
const WAREHOUSE_B_ID = "55555555-5555-4555-8555-555555555555";
const WAREHOUSE_C_ID = "77777777-7777-4777-8777-777777777777";

type SiteRecord = {
  id: string;
  tenantId: string;
  organizationId: string;
  code: string;
  name: string;
  isActive: boolean;
  updatedAt: Date;
  deletedAt: Date | null;
};

type WarehouseRecord = {
  id: string;
  tenantId: string;
  organizationId: string;
  code: string;
  name: string;
  isActive: boolean;
  updatedAt: Date;
  deletedAt: Date | null;
};

type RoleRecord = {
  id: string;
  tenantId: string;
  organizationId: string;
  site: SiteRecord;
  warehouse: WarehouseRecord;
  role: "raw_material";
  isDefault: boolean;
  updatedAt: Date;
  deletedAt: Date | null;
};

function matchesId(value: string, filter: unknown): boolean {
  if (typeof filter === "string") return value === filter;
  if (
    typeof filter === "object" &&
    filter !== null &&
    "$in" in filter &&
    Array.isArray(filter.$in)
  )
    return filter.$in.includes(value);
  return true;
}

function createStore() {
  const site: SiteRecord = {
    id: SITE_ID,
    tenantId: TENANT,
    organizationId: ORGANIZATION,
    code: "PLANT",
    name: "Plant",
    isActive: true,
    updatedAt: new Date("2026-08-28T10:00:00.000Z"),
    deletedAt: null,
  };
  const warehouses = new Map<string, WarehouseRecord>([
    [
      WAREHOUSE_A_ID,
      {
        id: WAREHOUSE_A_ID,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        code: "A",
        name: "Warehouse A",
        isActive: true,
        updatedAt: new Date("2026-08-28T10:00:00.000Z"),
        deletedAt: null,
      },
    ],
    [
      WAREHOUSE_B_ID,
      {
        id: WAREHOUSE_B_ID,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        code: "B",
        name: "Warehouse B",
        isActive: true,
        updatedAt: new Date("2026-08-28T10:00:00.000Z"),
        deletedAt: null,
      },
    ],
    [
      WAREHOUSE_C_ID,
      {
        id: WAREHOUSE_C_ID,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        code: "C",
        name: "Warehouse C",
        isActive: true,
        updatedAt: new Date("2026-08-28T10:00:00.000Z"),
        deletedAt: null,
      },
    ],
  ]);
  const roles = new Map<string, RoleRecord>();
  let sequence = 1;
  const manager = {
    findOne: jest.fn(
      async (entity: unknown, filters: Record<string, unknown>) => {
        if (entity === Site)
          return filters.id === site.id && site.deletedAt === null ? site : null;
        if (entity === Warehouse) {
          const record = typeof filters.id === "string" ? warehouses.get(filters.id) : undefined;
          return record?.deletedAt === null ? record : null;
        }
        if (entity === SiteWarehouseRole) {
          const record = typeof filters.id === "string" ? roles.get(filters.id) : undefined;
          return record && (filters.deletedAt !== null || record.deletedAt === null)
            ? record
            : null;
        }
        return null;
      },
    ),
    find: jest.fn(
      async (entity: unknown, filters: Record<string, unknown>) => {
        if (entity === Warehouse)
          return [...warehouses.values()].filter(
            (record) =>
              (filters.deletedAt !== null || record.deletedAt === null) &&
              matchesId(record.id, filters.id),
          );
        if (entity === SiteWarehouseRole)
          return [...roles.values()].filter((record) => {
            const siteFilter = filters.site;
            const roleFilter = filters.role;
            const warehouseFilter = filters.warehouse;
            return (
              record.deletedAt === null &&
              (siteFilter === undefined || siteFilter === record.site) &&
              (roleFilter === undefined || roleFilter === record.role) &&
              (warehouseFilter === undefined || matchesId(record.warehouse.id, warehouseFilter))
            );
          });
        return [];
      },
    ),
    create: jest.fn((_entity: unknown, data: Omit<RoleRecord, "id" | "updatedAt" | "deletedAt">) => {
      const record: RoleRecord = {
        ...data,
        id: `66666666-6666-4666-8666-${String(sequence).padStart(12, "0")}`,
        updatedAt: new Date("2026-08-28T10:00:00.000Z"),
        deletedAt: null,
      };
      sequence += 1;
      roles.set(record.id, record);
      return record;
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
  };
  return { manager, roles, site, warehouses };
}

function createContext(manager: ReturnType<typeof createStore>["manager"]) {
  const dataEngine = {
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn().mockResolvedValue(undefined),
    setCustomFields: jest.fn().mockResolvedValue(undefined),
  };
  return {
    auth: { tenantId: TENANT, orgId: ORGANIZATION },
    selectedOrganizationId: ORGANIZATION,
    container: {
      resolve: (name: string) => {
        if (name === "em") return { fork: () => manager };
        if (name === "dataEngine") return dataEngine;
        throw new Error(`[internal] Unexpected dependency: ${name}`);
      },
    },
  };
}

describe("WMS site warehouse role commands", () => {
  beforeAll(async () => {
    commandRegistry.clear?.();
    await import("../sites");
  });

  it("makes the first mapping default and atomically promotes a replacement", async () => {
    const store = createStore();
    const ctx = createContext(store.manager);
    const create = commandRegistry.get("wms.site-warehouse-roles.create");
    const update = commandRegistry.get("wms.site-warehouse-roles.update");
    expect(create).toBeTruthy();
    expect(update).toBeTruthy();

    const first = await create!.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_A_ID,
        role: "raw_material",
      },
      ctx as never,
    );
    const second = await create!.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_B_ID,
        role: "raw_material",
      },
      ctx as never,
    );
    store.manager.flush.mockClear();
    await update!.execute!(
      { id: second.assignmentId, isDefault: true },
      ctx as never,
    );

    expect(store.roles.get(first.assignmentId)?.isDefault).toBe(false);
    expect(store.roles.get(second.assignmentId)?.isDefault).toBe(true);
    expect(
      [...store.roles.values()].filter((record) => record.isDefault),
    ).toHaveLength(1);
    const warehouseLocks = store.manager.find.mock.calls.filter(
      ([entity]) => entity === Warehouse,
    );
    expect(warehouseLocks).not.toHaveLength(0);
    expect(store.manager.begin).toHaveBeenCalled();
    expect(store.manager.commit).toHaveBeenCalled();
    expect(store.manager.flush).toHaveBeenCalledTimes(3);
  });

  it("restores an update only when the default invariant can still hold", async () => {
    const store = createStore();
    const ctx = createContext(store.manager);
    const create = commandRegistry.get("wms.site-warehouse-roles.create");
    const update = commandRegistry.get("wms.site-warehouse-roles.update");
    expect(create).toBeTruthy();
    expect(update).toBeTruthy();

    const first = await create!.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_A_ID,
        role: "raw_material",
      },
      ctx as never,
    );
    const second = await create!.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_B_ID,
        role: "raw_material",
      },
      ctx as never,
    );
    await update!.execute!({ id: second.assignmentId, isDefault: true }, ctx as never);

    store.manager.flush.mockClear();
    await update!.undo!({
      input: {},
      logEntry: {
        commandPayload: {
          undo: {
            before: {
              id: second.assignmentId,
              tenantId: TENANT,
              organizationId: ORGANIZATION,
              siteId: SITE_ID,
              warehouseId: WAREHOUSE_B_ID,
              role: "raw_material",
              isDefault: false,
            },
            demotedDefaults: [
              {
                id: first.assignmentId,
                tenantId: TENANT,
                organizationId: ORGANIZATION,
                siteId: SITE_ID,
                warehouseId: WAREHOUSE_A_ID,
                role: "raw_material",
                isDefault: true,
              },
            ],
          },
        },
      },
      ctx,
      undoToken: "undo-role-update",
    } as never);

    expect(store.roles.get(first.assignmentId)?.isDefault).toBe(true);
    expect(store.roles.get(second.assignmentId)?.isDefault).toBe(false);
    expect(store.manager.flush).toHaveBeenCalledTimes(2);
  });

  it("undoes a default mapping creation by restoring the previous default", async () => {
    const store = createStore();
    const ctx = createContext(store.manager);
    const create = commandRegistry.get("wms.site-warehouse-roles.create");
    const first = await create!.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_A_ID,
        role: "raw_material",
      },
      ctx as never,
    );
    const second = await create!.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_B_ID,
        role: "raw_material",
        isDefault: true,
      },
      ctx as never,
    );

    await create!.undo!({
      logEntry: {
        commandPayload: {
          undo: {
            after: {
              id: second.assignmentId,
              tenantId: TENANT,
              organizationId: ORGANIZATION,
              siteId: SITE_ID,
              warehouseId: WAREHOUSE_B_ID,
              role: "raw_material",
              isDefault: true,
              updatedAt: "2026-08-28T10:00:00.000Z",
              siblingVersions: [
                {
                  id: first.assignmentId,
                  tenantId: TENANT,
                  organizationId: ORGANIZATION,
                  siteId: SITE_ID,
                  warehouseId: WAREHOUSE_A_ID,
                  role: "raw_material",
                  isDefault: false,
                  updatedAt: "2026-08-28T10:00:00.000Z",
                },
              ],
            },
            demotedDefaults: [
              {
                id: first.assignmentId,
                tenantId: TENANT,
                organizationId: ORGANIZATION,
                siteId: SITE_ID,
                warehouseId: WAREHOUSE_A_ID,
                role: "raw_material",
                isDefault: true,
                updatedAt: "2026-08-28T10:00:00.000Z",
              },
            ],
          },
        },
      },
      ctx,
      undoToken: "undo-default-role-create",
    } as never);

    expect(store.roles.get(first.assignmentId)?.isDefault).toBe(true);
    expect(store.roles.get(second.assignmentId)?.deletedAt).toBeInstanceOf(Date);
  });

  it("restores a deleted non-default mapping without creating a second default", async () => {
    const store = createStore();
    const ctx = createContext(store.manager);
    const create = commandRegistry.get("wms.site-warehouse-roles.create");
    const remove = commandRegistry.get("wms.site-warehouse-roles.delete");
    expect(create).toBeTruthy();
    expect(remove).toBeTruthy();

    await create!.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_A_ID,
        role: "raw_material",
      },
      ctx as never,
    );
    const second = await create!.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_B_ID,
        role: "raw_material",
      },
      ctx as never,
    );
    await remove!.execute!({ id: second.assignmentId }, ctx as never);
    await remove!.undo!({
      input: {},
      logEntry: {
        commandPayload: {
          undo: {
            before: {
              id: second.assignmentId,
              tenantId: TENANT,
              organizationId: ORGANIZATION,
              siteId: SITE_ID,
              warehouseId: WAREHOUSE_B_ID,
              role: "raw_material",
              isDefault: false,
            },
          },
        },
      },
      ctx,
      undoToken: "undo-role-delete",
    } as never);

    expect(store.roles.get(second.assignmentId)?.deletedAt).toBeNull();
    expect(
      [...store.roles.values()].filter(
        (record) => record.deletedAt === null && record.isDefault,
      ),
    ).toHaveLength(1);
  });

  it("makes a restored non-default mapping the default when its siblings were deleted", async () => {
    const store = createStore();
    const ctx = createContext(store.manager);
    const create = commandRegistry.get("wms.site-warehouse-roles.create")!;
    const remove = commandRegistry.get("wms.site-warehouse-roles.delete")!;
    const first = await create.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_A_ID,
        role: "raw_material",
      },
      ctx as never,
    );
    const second = await create.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_B_ID,
        role: "raw_material",
      },
      ctx as never,
    );

    await remove.execute!({ id: second.assignmentId }, ctx as never);
    await remove.execute!({ id: first.assignmentId }, ctx as never);
    await remove.undo!({
      logEntry: {
        commandPayload: {
          undo: {
            before: {
              id: second.assignmentId,
              tenantId: TENANT,
              organizationId: ORGANIZATION,
              siteId: SITE_ID,
              warehouseId: WAREHOUSE_B_ID,
              role: "raw_material",
              isDefault: false,
            },
          },
        },
      },
      ctx,
      undoToken: "undo-only-restored-role",
    } as never);

    expect(store.roles.get(second.assignmentId)).toMatchObject({
      deletedAt: null,
      isDefault: true,
    });
  });

  it("captures the default demoted inside the locked update execution for undo", async () => {
    const store = createStore();
    const ctx = createContext(store.manager);
    const create = commandRegistry.get("wms.site-warehouse-roles.create")!;
    const update = commandRegistry.get("wms.site-warehouse-roles.update")!;
    const first = await create.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_A_ID,
        role: "raw_material",
      },
      ctx as never,
    );
    const second = await create.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_B_ID,
        role: "raw_material",
      },
      ctx as never,
    );
    const third = await create.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_C_ID,
        role: "raw_material",
      },
      ctx as never,
    );
    const prepared = await update.prepare!(
      { id: second.assignmentId, isDefault: true },
      ctx as never,
    );
    await update.execute!(
      { id: third.assignmentId, isDefault: true },
      ctx as never,
    );

    const result = await update.execute!(
      { id: second.assignmentId, isDefault: true },
      ctx as never,
    );
    expect(result.demotedDefaults.map((item: { id: string }) => item.id)).toEqual([
      third.assignmentId,
    ]);
    expect(result.demotedDefaults.map((item: { id: string }) => item.id)).not.toContain(
      first.assignmentId,
    );
    const after = await update.captureAfter!(
      { id: second.assignmentId, isDefault: true },
      result,
      ctx as never,
    );
    const log = await update.buildLog!({
      input: { id: second.assignmentId, isDefault: true },
      result,
      ctx,
      snapshots: { before: prepared.before, after },
    } as never);
    await update.undo!({
      logEntry: { commandPayload: log.payload },
      ctx,
      undoToken: "undo-raced-default-update",
    } as never);

    expect(store.roles.get(second.assignmentId)?.isDefault).toBe(false);
    expect(store.roles.get(third.assignmentId)?.isDefault).toBe(true);
  });

  it("captures the default demoted inside the locked create execution for undo", async () => {
    const store = createStore();
    const ctx = createContext(store.manager);
    const create = commandRegistry.get("wms.site-warehouse-roles.create")!;
    const update = commandRegistry.get("wms.site-warehouse-roles.update")!;
    const first = await create.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_A_ID,
        role: "raw_material",
      },
      ctx as never,
    );
    const second = await create.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_B_ID,
        role: "raw_material",
      },
      ctx as never,
    );
    await create.prepare!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_C_ID,
        role: "raw_material",
        isDefault: true,
      },
      ctx as never,
    );
    await update.execute!(
      { id: second.assignmentId, isDefault: true },
      ctx as never,
    );

    const result = await create.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_C_ID,
        role: "raw_material",
        isDefault: true,
      },
      ctx as never,
    );
    expect(result.demotedDefaults.map((item: { id: string }) => item.id)).toEqual([
      second.assignmentId,
    ]);
    expect(result.demotedDefaults.map((item: { id: string }) => item.id)).not.toContain(
      first.assignmentId,
    );
    const after = await create.captureAfter!(
      {},
      result,
      ctx as never,
    );
    const log = await create.buildLog!({
      input: {},
      result,
      ctx,
      snapshots: { after },
    } as never);
    await create.undo!({
      logEntry: { commandPayload: log.payload },
      ctx,
      undoToken: "undo-raced-default-create",
    } as never);

    expect(store.roles.get(result.assignmentId)?.deletedAt).toBeInstanceOf(Date);
    expect(store.roles.get(second.assignmentId)?.isDefault).toBe(true);
  });

  it("allows deleting an assignment after its warehouse was soft-deleted", async () => {
    const store = createStore();
    const ctx = createContext(store.manager);
    const create = commandRegistry.get("wms.site-warehouse-roles.create")!;
    const remove = commandRegistry.get("wms.site-warehouse-roles.delete")!;
    const created = await create.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_A_ID,
        role: "raw_material",
      },
      ctx as never,
    );
    store.warehouses.get(WAREHOUSE_A_ID)!.deletedAt = new Date();

    await remove.execute!({ id: created.assignmentId }, ctx as never);

    expect(store.roles.get(created.assignmentId)?.deletedAt).toBeInstanceOf(Date);
  });

  it("fails closed for an inactive warehouse and a mismatched organization", async () => {
    const inactiveStore = createStore();
    const inactiveContext = createContext(inactiveStore.manager);
    inactiveStore.warehouses.get(WAREHOUSE_A_ID)!.isActive = false;
    const create = commandRegistry.get("wms.site-warehouse-roles.create");
    expect(create).toBeTruthy();

    await expect(
      create!.execute!(
        {
          tenantId: TENANT,
          organizationId: ORGANIZATION,
          siteId: SITE_ID,
          warehouseId: WAREHOUSE_A_ID,
          role: "raw_material",
        },
        inactiveContext as never,
      ),
    ).rejects.toThrow("Warehouse must be active.");

    const scopedStore = createStore();
    const scopedContext = createContext(scopedStore.manager);
    scopedContext.selectedOrganizationId =
      "99999999-9999-4999-8999-999999999999";
    await expect(
      create!.execute!(
        {
          tenantId: TENANT,
          organizationId: ORGANIZATION,
          siteId: SITE_ID,
          warehouseId: WAREHOUSE_A_ID,
          role: "raw_material",
        },
        scopedContext as never,
      ),
    ).rejects.toThrow();
  });

  it("refuses to demote the only default mapping", async () => {
    const store = createStore();
    const ctx = createContext(store.manager);
    const create = commandRegistry.get("wms.site-warehouse-roles.create");
    const update = commandRegistry.get("wms.site-warehouse-roles.update");
    expect(create).toBeTruthy();
    expect(update).toBeTruthy();
    const created = await create!.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_A_ID,
        role: "raw_material",
      },
      ctx as never,
    );

    await expect(
      update!.execute!({ id: created.assignmentId, isDefault: false }, ctx as never),
    ).rejects.toThrow("Promote a replacement before removing the default.");
  });

  it('deactivates a created Site undo through the warehouse-locking path', async () => {
    const store = createStore();
    const ctx = createContext(store.manager);
    const create = commandRegistry.get('wms.sites.create');
    const warehouse = store.warehouses.get(WAREHOUSE_A_ID)!;
    store.roles.set('role-1', {
      id: 'role-1',
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      site: store.site,
      warehouse,
      role: 'raw_material',
      isDefault: true,
      deletedAt: null,
    });

    await create!.undo!({
      logEntry: {
        commandPayload: {
          undo: {
            after: {
              id: SITE_ID,
              tenantId: TENANT,
              organizationId: ORGANIZATION,
              code: 'PLANT',
              name: 'Plant',
              isActive: true,
            },
          },
        },
      },
      ctx,
      undoToken: 'undo-site-create',
    } as never);

    expect(store.site.isActive).toBe(false);
    expect(
      store.manager.find.mock.calls.some(([entity]) => entity === Warehouse),
    ).toBe(true);
    expect(store.manager.begin).toHaveBeenCalled();
    expect(store.manager.commit).toHaveBeenCalled();
  });

  it('fails closed when undoing an activation would reuse another active Site warehouse', async () => {
    const store = createStore();
    const ctx = createContext(store.manager);
    const update = commandRegistry.get('wms.sites.update');
    const warehouse = store.warehouses.get(WAREHOUSE_A_ID)!;
    const otherSite: SiteRecord = {
      id: '99999999-9999-4999-8999-999999999999',
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      code: 'OTHER',
      name: 'Other plant',
      isActive: true,
      deletedAt: null,
    };
    store.site.isActive = false;
    store.roles.set('role-2', {
      id: 'role-2',
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      site: store.site,
      warehouse,
      role: 'raw_material',
      isDefault: true,
      deletedAt: null,
    });
    store.roles.set('role-3', {
      id: 'role-3',
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      site: otherSite,
      warehouse,
      role: 'raw_material',
      isDefault: true,
      deletedAt: null,
    });

    await expect(
      update!.undo!({
        logEntry: {
          commandPayload: {
            undo: {
              before: {
                id: SITE_ID,
                tenantId: TENANT,
                organizationId: ORGANIZATION,
                code: 'PLANT',
                name: 'Plant',
                isActive: true,
              },
              after: {
                id: SITE_ID,
                tenantId: TENANT,
                organizationId: ORGANIZATION,
                code: 'PLANT',
                name: 'Plant',
                isActive: false,
              },
            },
          },
        },
        ctx,
        undoToken: 'undo-site-activation',
      } as never),
    ).rejects.toThrow('Warehouse is already assigned to another active site.');

    expect(store.site.isActive).toBe(false);
  });

  it('accepts a Site update containing only custom fields', async () => {
    const store = createStore();
    const ctx = createContext(store.manager);
    const update = commandRegistry.get('wms.sites.update');

    const previousUpdatedAt = store.site.updatedAt;
    await expect(
      update!.execute!(
        { id: SITE_ID, cf_priority: 'high' },
        ctx as never,
      ),
    ).resolves.toEqual({ siteId: SITE_ID });
    expect(store.site.updatedAt.getTime()).toBeGreaterThan(
      previousUpdatedAt.getTime(),
    );
    expect(store.manager.findOne).toHaveBeenCalledWith(
      Site,
      expect.objectContaining({
        id: SITE_ID,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
      }),
      expect.anything(),
    );
  });

  it('rejects a stale Site undo without changing the current record', async () => {
    const store = createStore();
    const ctx = createContext(store.manager);
    const update = commandRegistry.get('wms.sites.update');
    store.site.name = 'Newer name';
    store.site.updatedAt = new Date('2026-08-28T12:00:00.000Z');

    await expect(
      update!.undo!({
        logEntry: {
          commandPayload: {
            undo: {
              before: {
                id: SITE_ID,
                tenantId: TENANT,
                organizationId: ORGANIZATION,
                code: 'PLANT',
                name: 'Plant',
                isActive: true,
                updatedAt: '2026-08-28T10:00:00.000Z',
              },
              after: {
                id: SITE_ID,
                tenantId: TENANT,
                organizationId: ORGANIZATION,
                code: 'PLANT',
                name: 'First edit',
                isActive: true,
                updatedAt: '2026-08-28T11:00:00.000Z',
              },
            },
          },
        },
        ctx,
        undoToken: 'undo-stale-site-update',
      } as never),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: 'optimistic_lock_conflict' },
    });
    expect(store.site.name).toBe('Newer name');
  });

  it('locks warehouses before locking an assignment during update', async () => {
    const store = createStore();
    const ctx = createContext(store.manager);
    const create = commandRegistry.get('wms.site-warehouse-roles.create');
    const update = commandRegistry.get('wms.site-warehouse-roles.update');
    const created = await create!.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_A_ID,
        role: 'raw_material',
      },
      ctx as never,
    );
    store.manager.find.mockClear();
    store.manager.findOne.mockClear();

    await update!.execute!({ id: created.assignmentId, isDefault: true }, ctx as never);

    const warehouseLockOrder = store.manager.find.mock.invocationCallOrder.find(
      (_order, index) => store.manager.find.mock.calls[index]?.[0] === Warehouse,
    );
    const assignmentLockOrder = store.manager.find.mock.invocationCallOrder.find(
      (_order, index) => {
        const [entity, , options] = store.manager.find.mock.calls[index] ?? [];
        return entity === SiteWarehouseRole && options !== undefined;
      },
    );
    expect(warehouseLockOrder).toBeDefined();
    expect(assignmentLockOrder).toBeDefined();
    expect(warehouseLockOrder!).toBeLessThan(assignmentLockOrder!);
  });

  it('rejects a stale warehouse-role undo without changing the assignment', async () => {
    const store = createStore();
    const ctx = createContext(store.manager);
    const create = commandRegistry.get('wms.site-warehouse-roles.create');
    const update = commandRegistry.get('wms.site-warehouse-roles.update');
    const created = await create!.execute!(
      {
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        siteId: SITE_ID,
        warehouseId: WAREHOUSE_A_ID,
        role: 'raw_material',
      },
      ctx as never,
    );
    const assignment = store.roles.get(created.assignmentId)!;
    assignment.updatedAt = new Date('2026-08-28T12:00:00.000Z');

    await expect(
      update!.undo!({
        logEntry: {
          commandPayload: {
            undo: {
              before: {
                id: assignment.id,
                tenantId: TENANT,
                organizationId: ORGANIZATION,
                siteId: SITE_ID,
                warehouseId: WAREHOUSE_A_ID,
                role: 'raw_material',
                isDefault: true,
                updatedAt: '2026-08-28T10:00:00.000Z',
              },
              after: {
                id: assignment.id,
                tenantId: TENANT,
                organizationId: ORGANIZATION,
                siteId: SITE_ID,
                warehouseId: WAREHOUSE_B_ID,
                role: 'raw_material',
                isDefault: true,
                updatedAt: '2026-08-28T11:00:00.000Z',
              },
            },
          },
        },
        ctx,
        undoToken: 'undo-stale-role-update',
      } as never),
    ).rejects.toMatchObject({
      status: 409,
      body: { code: 'optimistic_lock_conflict' },
    });
    expect(assignment.warehouse.id).toBe(WAREHOUSE_A_ID);
  });
});
