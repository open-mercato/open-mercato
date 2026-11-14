import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';

/**
 * Direct-Postgres read helpers for the Phase 3 (Step 6.8) live specs.
 *
 * `promotion_usages`/`promotion_codes`/`promotion_code_reservations`/
 * `promotion_code_usages` carry fields (`effects_snapshot`, `reverted_at`, `used`,
 * `active`) no API route exposes — `usage/register` and `usage/revert` answer only
 * `{ ok, budgetExceeded }` / `{ ok, revertedCount }` (SPEC-055 §Cart-Facing Endpoints),
 * and no admin route lists `PromotionUsage` rows at all. Proving TC-PROM-023/024's
 * exact-row claims ("effects_snapshot", "total_discount_amount excluding
 * ADD_FREE_ITEM", "reverted_at set, never deleted") through the real HTTP route
 * therefore needs a direct read, same convention as `workflows/__integration__/helpers/
 * db.ts` and `shipping_carriers/__integration__/helpers/db.ts`.
 */

export type PromotionUsageRow = {
  id: string;
  organization_id: string;
  tenant_id: string;
  promotion_id: string;
  order_id: string;
  order_type: string;
  customer_id: string | null;
  currency: string;
  total_discount_amount: string;
  effects_snapshot: unknown;
  registered_at: string;
  reverted_at: string | null;
};

export async function readPromotionUsageRows(input: {
  promotionId: string;
  organizationId: string;
  tenantId: string;
  orderId: string;
}): Promise<PromotionUsageRow[]> {
  return withClient(async (client) => {
    const result = await client.query<PromotionUsageRow>(
      `select id, organization_id, tenant_id, promotion_id, order_id, order_type, customer_id,
              currency, total_discount_amount, effects_snapshot, registered_at, reverted_at
         from promotion_usages
        where promotion_id = $1 and organization_id = $2 and tenant_id = $3 and order_id = $4`,
      [input.promotionId, input.organizationId, input.tenantId, input.orderId],
    );
    return result.rows;
  });
}

export async function sumPromotionUsageInDb(input: {
  promotionId: string;
  organizationId: string;
  tenantId: string;
  currency: string;
}): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ total: string | null }>(
      `select coalesce(sum(total_discount_amount), 0)::text as total
         from promotion_usages
        where promotion_id = $1 and organization_id = $2 and tenant_id = $3 and currency = $4 and reverted_at is null`,
      [input.promotionId, input.organizationId, input.tenantId, input.currency],
    );
    return result.rows[0]?.total ?? '0';
  });
}

export async function deletePromotionUsageRowsInDb(promotionId: string | null): Promise<void> {
  if (!promotionId) return;
  await withClient(async (client) => {
    await client.query('delete from promotion_usages where promotion_id = $1', [promotionId]);
  });
}

export type PromotionCodeRow = {
  id: string;
  used: number;
  active: boolean;
  generated: number;
};

export async function readCodeRow(codeId: string): Promise<PromotionCodeRow | null> {
  return withClient(async (client) => {
    const result = await client.query<PromotionCodeRow>(
      'select id, used, active, generated from promotion_codes where id = $1',
      [codeId],
    );
    return result.rows[0] ?? null;
  });
}

export async function countCodeUsageRowsInDb(codeId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'select count(*)::text as count from promotion_code_usages where code_id = $1',
      [codeId],
    );
    return Number(result.rows[0]?.count ?? '0');
  });
}

export async function codeReservationExistsInDb(input: { codeId: string; cartId: string }): Promise<boolean> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'select count(*)::text as count from promotion_code_reservations where code_id = $1 and cart_id = $2',
      [input.codeId, input.cartId],
    );
    return Number(result.rows[0]?.count ?? '0') > 0;
  });
}
