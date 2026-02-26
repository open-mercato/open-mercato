import type { ImportRecordInput, ImportRecordResult } from "./types";
import { postToOmApi } from "./types";

const PRODUCT_FIELD_MAP: Record<string, string> = {
  name: "title",
  nazwa: "title",
  title: "title",
  tytul: "title",
  sku: "sku",
  description: "description",
  opis: "description",
  weight: "weightValue",
  waga: "weightValue",
  handle: "handle",
};

export async function importProduct(
  input: ImportRecordInput,
): Promise<ImportRecordResult> {
  const mapped: Record<string, unknown> = {
    id: input.omId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  };

  for (const [omKey, value] of Object.entries(input.fields)) {
    const apiField = PRODUCT_FIELD_MAP[omKey.toLowerCase()];
    if (apiField) mapped[apiField] = value;
    else mapped[omKey] = value;
  }

  if (!mapped.title) mapped.title = mapped.name ?? input.airtableId;

  const price =
    input.fields["price"] ??
    input.fields["cena"] ??
    input.fields["Price"] ??
    input.fields["Cena"];
  if (price !== undefined && price !== null) {
    mapped.offers = [{ price: Number(price), currencyCode: "PLN" }];
  }

  return postToOmApi(
    "/api/catalog/products",
    mapped,
    input.omUrl,
    input.omApiKey,
  );
}
