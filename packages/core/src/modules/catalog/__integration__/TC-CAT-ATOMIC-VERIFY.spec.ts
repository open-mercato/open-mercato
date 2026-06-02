import { expect, test, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createCategoryFixture,
  createProductFixture,
  createVariantFixture,
  deleteCatalogCategoryIfExists,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures';

/**
 * TC-CAT-ATOMIC-VERIFY: backward-compatibility + data-safety verification for the
 * catalog atomic-write refactor (#2368) and the generic `makeCrudRoute` atomic
 * entity+custom-field path (#2376).
 *
 * Each block asserts observable contract behaviour against the running API rather
 * than internal transaction mechanics:
 *  - product scalar + custom-field round-trip on create and update (#2376 atomicity
 *    contract: the entity row and its custom-field values land together);
 *  - variant single-default enforcement still holds after the atomic refactor;
 *  - category parent/child hierarchy stays consistent on read;
 *  - the audit-log undo round-trip reverts both create and update.
 *
 * Undo note: `/api/audit_logs/audit-logs/actions/undo` only reverts the LATEST
 * undoable action for the resource/actor, so every undo here immediately follows
 * its triggering write with no intervening undoable mutation on another resource.
 */

type ProductReadItem = {
  id: string;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  sku?: string | null;
  handle?: string | null;
  product_type?: string | null;
  is_configurable?: boolean | null;
  is_active?: boolean | null;
  cf_style_code?: string | null;
  cf_service_duration_minutes?: number | null;
  customValues?: Record<string, unknown> | null;
};

type VariantReadItem = {
  id: string;
  name?: string | null;
  is_default?: boolean | null;
};

type CategoryManageItem = {
  id: string;
  name: string;
  parentId?: string | null;
  childCount?: number;
};

type CategoryTreeNode = {
  id: string;
  parentId: string | null;
  childIds: string[];
  children: CategoryTreeNode[];
};

function parseUndoToken(res: APIResponse): string {
  const header = res.headers()['x-om-operation'] ?? '';
  expect(header.startsWith('omop:'), 'create/update emits x-om-operation header').toBeTruthy();
  const decoded = JSON.parse(decodeURIComponent(header.slice(5))) as { undoToken?: string };
  expect(typeof decoded.undoToken === 'string' && decoded.undoToken.length > 0).toBeTruthy();
  return decoded.undoToken as string;
}

async function readProduct(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  productId: string,
): Promise<ProductReadItem | null> {
  const res = await apiRequest(request, 'GET', `/api/catalog/products?id=${encodeURIComponent(productId)}`, { token });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { items?: ProductReadItem[]; total?: number };
  const items = body.items ?? [];
  return items[0] ?? null;
}

test.describe('TC-CAT-ATOMIC-VERIFY: catalog atomic-write BC + data safety', () => {
  test('product field + custom-field round-trip survives create and update', async ({ request }) => {
    let token: string | null = null;
    let productId: string | null = null;
    const stamp = Date.now();
    const created = {
      title: `QA Atomic Verify ${stamp}`,
      subtitle: `Subtitle ${stamp}`,
      description:
        'Long enough description for the catalog atomic write verification suite to satisfy create validation.',
      sku: `QA-AV-${stamp}`,
      handle: `qa-av-${stamp}`,
      productType: 'configurable',
      isConfigurable: true,
      isActive: false,
      cf_style_code: `STYLE-${stamp}`,
      cf_service_duration_minutes: 45,
    };

    try {
      token = await getAuthToken(request, 'admin');

      const createRes = await apiRequest(request, 'POST', '/api/catalog/products', {
        token,
        data: created,
      });
      expect(createRes.status(), 'product created').toBe(201);
      productId = ((await createRes.json()) as { id: string }).id;
      expect(typeof productId === 'string' && productId.length > 0).toBeTruthy();

      const afterCreate = await readProduct(request, token, productId);
      expect(afterCreate, 'created product is readable').not.toBeNull();
      expect(afterCreate!.title).toBe(created.title);
      expect(afterCreate!.subtitle).toBe(created.subtitle);
      expect(afterCreate!.description).toBe(created.description);
      expect(afterCreate!.sku).toBe(created.sku);
      expect(afterCreate!.handle).toBe(created.handle);
      expect(afterCreate!.product_type).toBe(created.productType);
      expect(afterCreate!.is_configurable).toBe(true);
      expect(afterCreate!.is_active).toBe(false);
      // #2376: entity scalar + custom-field land together; read normalizes to bare keys.
      expect(afterCreate!.cf_style_code).toBe(created.cf_style_code);
      expect(afterCreate!.cf_service_duration_minutes).toBe(created.cf_service_duration_minutes);
      expect(afterCreate!.customValues?.style_code).toBe(created.cf_style_code);
      expect(afterCreate!.customValues?.service_duration_minutes).toBe(created.cf_service_duration_minutes);

      const updated = {
        id: productId,
        title: `QA Atomic Verify UPDATED ${stamp}`,
        subtitle: `Subtitle UPDATED ${stamp}`,
        isActive: true,
        cf_style_code: `STYLE-UPDATED-${stamp}`,
        cf_service_duration_minutes: 90,
      };
      const updateRes = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: updated,
      });
      expect(updateRes.status(), 'product updated').toBe(200);
      expect((await updateRes.json()) as { ok?: boolean }).toEqual({ ok: true });

      const afterUpdate = await readProduct(request, token, productId);
      expect(afterUpdate, 'updated product is readable').not.toBeNull();
      expect(afterUpdate!.title).toBe(updated.title);
      expect(afterUpdate!.subtitle).toBe(updated.subtitle);
      expect(afterUpdate!.is_active).toBe(true);
      // Untouched scalar fields are preserved by the atomic update.
      expect(afterUpdate!.sku).toBe(created.sku);
      expect(afterUpdate!.handle).toBe(created.handle);
      expect(afterUpdate!.product_type).toBe(created.productType);
      // Custom-field update lands atomically with the scalar update.
      expect(afterUpdate!.cf_style_code).toBe(updated.cf_style_code);
      expect(afterUpdate!.cf_service_duration_minutes).toBe(updated.cf_service_duration_minutes);
      expect(afterUpdate!.customValues?.style_code).toBe(updated.cf_style_code);
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });

  test('variant single-default enforcement holds after the atomic refactor', async ({ request }) => {
    let token: string | null = null;
    let productId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request, 'admin');
      productId = await createProductFixture(request, token, {
        title: `QA Atomic Verify Variant Host ${stamp}`,
        sku: `QA-AVVH-${stamp}`,
      });

      const firstVariantId = await createVariantFixture(request, token, {
        productId,
        name: `V1 ${stamp}`,
        sku: `QA-AVV1-${stamp}`,
        isDefault: true,
      });
      const secondVariantId = await createVariantFixture(request, token, {
        productId,
        name: `V2 ${stamp}`,
        sku: `QA-AVV2-${stamp}`,
        isDefault: false,
      });
      expect(firstVariantId).not.toBe(secondVariantId);

      const readVariants = async (): Promise<VariantReadItem[]> => {
        const res = await apiRequest(
          request,
          'GET',
          `/api/catalog/variants?productId=${encodeURIComponent(productId!)}&pageSize=100`,
          { token: token! },
        );
        expect(res.status()).toBe(200);
        return ((await res.json()) as { items?: VariantReadItem[] }).items ?? [];
      };

      const afterCreate = await readVariants();
      expect(afterCreate.filter((variant) => variant.is_default === true).length, 'exactly one default after create').toBe(1);
      expect(afterCreate.find((variant) => variant.id === firstVariantId)?.is_default).toBe(true);

      const promoteRes = await apiRequest(request, 'PUT', '/api/catalog/variants', {
        token,
        data: { id: secondVariantId, isDefault: true },
      });
      expect(promoteRes.status(), 'second variant promoted to default').toBe(200);

      const afterPromote = await readVariants();
      expect(afterPromote.filter((variant) => variant.is_default === true).length, 'single default holds after promotion').toBe(1);
      expect(afterPromote.find((variant) => variant.id === secondVariantId)?.is_default).toBe(true);
      expect(afterPromote.find((variant) => variant.id === firstVariantId)?.is_default).toBe(false);
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });

  test('category parent/child hierarchy is consistent on read', async ({ request }) => {
    let token: string | null = null;
    let parentId: string | null = null;
    let childId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request, 'admin');
      parentId = await createCategoryFixture(request, token, { name: `QA Atomic Verify Parent ${stamp}` });

      const childRes = await apiRequest(request, 'POST', '/api/catalog/categories', {
        token,
        data: { name: `QA Atomic Verify Child ${stamp}`, parentId },
      });
      expect(childRes.status(), 'child category created').toBe(201);
      childId = ((await childRes.json()) as { id: string }).id;
      expect(typeof childId === 'string' && childId.length > 0).toBeTruthy();

      const manageRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/categories?view=manage&pageSize=200&search=${encodeURIComponent(`QA Atomic Verify`)}`,
        { token },
      );
      expect(manageRes.status()).toBe(200);
      const manageItems = ((await manageRes.json()) as { items?: CategoryManageItem[] }).items ?? [];
      const parentRow = manageItems.find((row) => row.id === parentId);
      const childRow = manageItems.find((row) => row.id === childId);
      expect(parentRow, 'parent present in manage view').toBeTruthy();
      expect(childRow, 'child present in manage view').toBeTruthy();
      expect(parentRow!.parentId ?? null, 'parent has no parent').toBeNull();
      expect(childRow!.parentId, 'child points at parent').toBe(parentId);
      expect(parentRow!.childCount, 'parent reports one child').toBe(1);

      const treeRes = await apiRequest(request, 'GET', '/api/catalog/categories?view=tree', { token });
      expect(treeRes.status()).toBe(200);
      const treeRoots = ((await treeRes.json()) as { items?: CategoryTreeNode[] }).items ?? [];
      const flat: CategoryTreeNode[] = [];
      const walk = (nodes: CategoryTreeNode[]) => {
        for (const node of nodes) {
          flat.push(node);
          walk(node.children ?? []);
        }
      };
      walk(treeRoots);
      const parentNode = flat.find((node) => node.id === parentId);
      const childNode = flat.find((node) => node.id === childId);
      expect(parentNode, 'parent present in tree view').toBeTruthy();
      expect(childNode, 'child present in tree view').toBeTruthy();
      expect(parentNode!.childIds, 'parent childIds includes child').toContain(childId);
      expect(childNode!.parentId, 'child parentId matches parent in tree').toBe(parentId);
    } finally {
      await deleteCatalogCategoryIfExists(request, token, childId);
      await deleteCatalogCategoryIfExists(request, token, parentId);
    }
  });

  test('undo reverts a product create (record removed)', async ({ request }) => {
    let token: string | null = null;
    let productId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request, 'admin');

      const createRes = await apiRequest(request, 'POST', '/api/catalog/products', {
        token,
        data: {
          title: `QA Atomic Verify Undo Create ${stamp}`,
          sku: `QA-AVUC-${stamp}`,
          description:
            'Long enough description for the catalog undo-create verification to satisfy create validation.',
        },
      });
      expect(createRes.status(), 'product created').toBe(201);
      productId = ((await createRes.json()) as { id: string }).id;
      const undoToken = parseUndoToken(createRes);

      const undoRes = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
        token,
        data: { undoToken },
      });
      expect(undoRes.status(), 'undo of create succeeds').toBe(200);
      expect(((await undoRes.json()) as { ok?: boolean }).ok).toBe(true);

      const afterUndo = await apiRequest(
        request,
        'GET',
        `/api/catalog/products?id=${encodeURIComponent(productId)}`,
        { token },
      );
      expect(afterUndo.status()).toBe(200);
      const body = (await afterUndo.json()) as { items?: unknown[]; total?: number };
      expect(body.total ?? (body.items ?? []).length, 'product removed after undo of create').toBe(0);
      productId = null;
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });

  test('undo reverts a product update (prior values restored)', async ({ request }) => {
    let token: string | null = null;
    let productId: string | null = null;
    const stamp = Date.now();
    const originalTitle = `QA Atomic Verify Undo Update ${stamp}`;
    const originalSubtitle = `Original subtitle ${stamp}`;

    try {
      token = await getAuthToken(request, 'admin');

      const createRes = await apiRequest(request, 'POST', '/api/catalog/products', {
        token,
        data: {
          title: originalTitle,
          subtitle: originalSubtitle,
          sku: `QA-AVUU-${stamp}`,
          description:
            'Long enough description for the catalog undo-update verification to satisfy create validation.',
          isActive: false,
        },
      });
      expect(createRes.status(), 'product created').toBe(201);
      productId = ((await createRes.json()) as { id: string }).id;

      const updateRes = await apiRequest(request, 'PUT', '/api/catalog/products', {
        token,
        data: {
          id: productId,
          title: `${originalTitle} CHANGED`,
          subtitle: `${originalSubtitle} CHANGED`,
          isActive: true,
        },
      });
      expect(updateRes.status(), 'product updated').toBe(200);
      const undoToken = parseUndoToken(updateRes);

      const afterUpdate = await readProduct(request, token, productId);
      expect(afterUpdate!.title).toBe(`${originalTitle} CHANGED`);
      expect(afterUpdate!.is_active).toBe(true);

      const undoRes = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
        token,
        data: { undoToken },
      });
      expect(undoRes.status(), 'undo of update succeeds').toBe(200);
      expect(((await undoRes.json()) as { ok?: boolean }).ok).toBe(true);

      const afterUndo = await readProduct(request, token, productId);
      expect(afterUndo, 'product still present after undo of update').not.toBeNull();
      expect(afterUndo!.title, 'title restored').toBe(originalTitle);
      expect(afterUndo!.subtitle, 'subtitle restored').toBe(originalSubtitle);
      expect(afterUndo!.is_active, 'isActive restored').toBe(false);
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
