import type { ImportRecordInput, ImportRecordResult } from "./types";
import { postToOmApi } from "./types";

const ORDER_FIELD_MAP: Record<string, string> = {
  order_number: "orderNumber",
  numer_zamowienia: "orderNumber",
  nr_zamowienia: "orderNumber",
  total: "grandTotalGrossAmount",
  kwota: "grandTotalGrossAmount",
  wartosc: "grandTotalGrossAmount",
  currency: "currencyCode",
  waluta: "currencyCode",
  comments: "comments",
  uwagi: "comments",
  komentarz: "comments",
  internal_notes: "internalNotes",
  placed_at: "placedAt",
  data_zamowienia: "placedAt",
};

export async function importOrder(
  input: ImportRecordInput,
): Promise<ImportRecordResult> {
  const mapped: Record<string, unknown> = {
    id: input.omId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    currencyCode: "PLN",
  };

  for (const [omKey, value] of Object.entries(input.fields)) {
    const apiField = ORDER_FIELD_MAP[omKey.toLowerCase()];
    if (apiField) mapped[apiField] = value;
    else mapped[omKey] = value;
  }

  return postToOmApi("/api/sales/orders", mapped, input.omUrl, input.omApiKey);
}
