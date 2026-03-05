import { SalesQuoteLine } from "../../data/entities";
import { quoteLineCreateSchema } from "../../data/validators";
import { E } from "#generated/entities.ids.generated";
import * as F from "#generated/entities/sales_quote_line";
import { makeSalesLineRoute } from "../../lib/makeSalesLineRoute";

const route = makeSalesLineRoute({
  entity: SalesQuoteLine,
  entityId: E.sales.sales_quote_line,
  fieldConstants: F,
  parentFkColumn: "quote_id",
  parentFkParam: "quoteId",
  createSchema: quoteLineCreateSchema,
  features: { view: "sales.quotes.view", manage: "sales.quotes.manage" },
  commandPrefix: "sales.quotes.lines",
  openApi: {
    resourceName: "Quote line",
    description: "a quote line and recalculates totals",
  },
});

export const { GET, POST, PUT, DELETE } = route;
export const openApi = route.openApi;
