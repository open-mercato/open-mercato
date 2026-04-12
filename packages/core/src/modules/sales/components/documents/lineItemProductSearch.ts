import type { LookupSelectItem } from "@open-mercato/ui/backend/inputs";

type ProductLookupOption = {
  id: string;
  title: string;
  sku: string | null;
};

type RankedProductCandidate = {
  item: LookupSelectItem & { option: ProductLookupOption };
  score: number;
};

function normalizeSearchNeedle(query?: string): string {
  return query?.trim().toLowerCase() ?? "";
}

function scoreProductSearchMatch(
  query: string,
  product: { title: string; sku: string | null },
): number | null {
  const needle = normalizeSearchNeedle(query);
  if (!needle) return 0;
  const title = product.title.toLowerCase();
  const sku = product.sku?.toLowerCase() ?? "";
  if (title === needle) return 0;
  if (sku === needle) return 1;
  if (title.startsWith(needle)) return 2;
  if (sku.startsWith(needle)) return 3;
  if (title.includes(needle)) return 4;
  if (sku.includes(needle)) return 5;
  return null;
}

export function rankProductLookupItems<T extends ProductLookupOption>(
  query: string,
  items: Array<LookupSelectItem & { option: T }>,
): Array<LookupSelectItem & { option: T }> {
  const needle = normalizeSearchNeedle(query);
  if (!needle) return items;
  return items
    .map<RankedProductCandidate | null>((item) => {
      const score = scoreProductSearchMatch(needle, {
        title: item.option.title,
        sku: item.option.sku ?? null,
      });
      if (score === null) return null;
      return {
        item: item as LookupSelectItem & { option: ProductLookupOption },
        score,
      };
    })
    .filter((entry): entry is RankedProductCandidate => Boolean(entry))
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      return left.item.option.title.localeCompare(right.item.option.title);
    })
    .map((entry) => entry.item as LookupSelectItem & { option: T });
}
