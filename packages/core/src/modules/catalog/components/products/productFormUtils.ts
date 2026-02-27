import { REFERENCE_UNIT_CODES, type ReferenceUnitCode } from "@open-mercato/shared/lib/units/unitCodes";
import { canonicalizeUnitCode } from "../../lib/unitCodes";
import { createCrudFormError } from "@open-mercato/ui/backend/utils/serverErrors";
import type { ProductUnitConversionDraft } from "./productForm";

export const UNIT_PRICE_REFERENCE_UNITS = new Set<ReferenceUnitCode>(REFERENCE_UNIT_CODES);

export function toTrimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function parseNumericInput(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s+/g, "").replace(/,/g, ".");
    if (!normalized.length) return Number.NaN;
    return Number(normalized);
  }
  return Number(value);
}

export function toPositiveNumberOrNull(value: unknown): number | null {
  const numeric = parseNumericInput(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

export function toIntegerInRangeOrDefault(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric = parseNumericInput(value);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max)
    return fallback;
  return numeric;
}

export type ProductUnitConversionInput = {
  id?: string | null;
  unitCode: string;
  toBaseFactor: number;
  sortOrder: number;
  isActive: boolean;
};

export function normalizeProductConversionInputs(
  rows: ProductUnitConversionDraft[] | undefined,
  duplicateMessage: string,
): ProductUnitConversionInput[] {
  const list = Array.isArray(rows) ? rows : [];
  const normalized: ProductUnitConversionInput[] = [];
  const seen = new Set<string>();
  for (const row of list) {
    const unitCode = canonicalizeUnitCode(row?.unitCode);
    const toBaseFactor = toPositiveNumberOrNull(row?.toBaseFactor);
    if (!unitCode || toBaseFactor === null) continue;
    const unitKey = unitCode.toLowerCase();
    if (seen.has(unitKey)) {
      throw createCrudFormError(duplicateMessage, {
        unitConversions: duplicateMessage,
      });
    }
    seen.add(unitKey);
    normalized.push({
      id: toTrimmedOrNull(row?.id),
      unitCode,
      toBaseFactor,
      sortOrder: toIntegerInRangeOrDefault(
        row?.sortOrder,
        0,
        100000,
        normalized.length * 10,
      ),
      isActive: row?.isActive !== false,
    });
  }
  return normalized;
}
