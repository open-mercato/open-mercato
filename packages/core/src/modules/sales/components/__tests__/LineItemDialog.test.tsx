import { rankProductLookupItems } from "../documents/lineItemProductSearch";

type ProductOption = {
  id: string;
  title: string;
  sku: string | null;
  thumbnailUrl: string | null;
  taxRateId?: string | null;
  taxRate?: number | null;
  defaultUnit?: string | null;
  defaultSalesUnit?: string | null;
  defaultSalesUnitQuantity?: number | null;
};

function makeItem(
  id: string,
  title: string,
  sku: string | null,
): { id: string; title: string; option: ProductOption } {
  return {
    id,
    title,
    option: {
      id,
      title,
      sku,
      thumbnailUrl: null,
    },
  };
}

describe("rankProductLookupItems", () => {
  it("prioritizes exact and title-based matches over weaker matches", () => {
    const ranked = rankProductLookupItems("aurora", [
      makeItem("1", "Alpha", "SKU-A"),
      makeItem("2", "Aurora", "AU-01"),
      makeItem("3", "Northern Lights", "AURORA-SKU"),
      makeItem("4", "Aurora Borealis", "AB-01"),
    ]);

    expect(ranked.map((entry) => entry.option.title)).toEqual([
      "Aurora",
      "Aurora Borealis",
      "Northern Lights",
    ]);
  });

  it("keeps all items when the query is empty", () => {
    const items = [
      makeItem("1", "Beta", "B-1"),
      makeItem("2", "Aurora", "AU-01"),
    ];

    expect(rankProductLookupItems("", items)).toEqual(items);
  });
});
