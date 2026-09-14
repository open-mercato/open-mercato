import { SalesOrderLine } from "../../data/entities";
import { orderLineCreateSchema, orderTotalsSchema } from "../../data/validators";
import { E } from "#generated/entities.ids.generated";
import * as F from "#generated/entities/sales_order_line";
import { makeSalesLineRoute } from "../../lib/makeSalesLineRoute";

const route = makeSalesLineRoute({
  entity: SalesOrderLine,
  entityId: E.sales.sales_order_line,
  fieldConstants: F,
  parentFkColumn: "order_id",
  parentFkParam: "orderId",
  createSchema: orderLineCreateSchema,
  // An external order will not have its header rebuilt from the lines, so every
  // line write against one must restate it (`sales.orders.lines.*` rejects the
  // request otherwise).
  writeExtensionShape: { orderTotals: orderTotalsSchema.optional() },
  features: { view: "sales.orders.view", manage: "sales.orders.manage" },
  commandPrefix: "sales.orders.lines",
  openApi: {
    resourceName: "Order line",
    description: "an order line and recalculates totals",
  },
});

export const metadata = route.metadata;
export const { GET, POST, PUT, DELETE } = route;
export const openApi = route.openApi;
