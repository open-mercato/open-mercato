"use client";

import * as React from "react";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall";
import { Button } from "@open-mercato/ui/primitives/button";
import { Checkbox } from "@open-mercato/ui/primitives/checkbox";
import { Input } from "@open-mercato/ui/primitives/input";
import { Label } from "@open-mercato/ui/primitives/label";
import { Plus, Trash2 } from "lucide-react";
import type {
  ProductFormValues,
  ProductUnitConversionDraft,
} from "./productForm";
import { createProductUnitConversionDraft } from "./productForm";

type UnitDictionaryEntry = {
  id?: string;
  value?: string;
  label?: string;
};

type UnitDictionaryResponse = {
  entries?: UnitDictionaryEntry[];
};

type UnitOption = {
  value: string;
  label: string;
};

type ProductUomSectionProps = {
  values: ProductFormValues;
  errors: Record<string, string>;
  setValue: (id: string, value: unknown) => void;
  embedded?: boolean;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeConversions(value: unknown): ProductUnitConversionDraft[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as ProductUnitConversionDraft;
      return {
        id: normalizeText(row.id) ?? null,
        unitCode: normalizeText(row.unitCode) ?? "",
        toBaseFactor: normalizeText(row.toBaseFactor) ?? "",
        sortOrder: normalizeText(row.sortOrder) ?? "",
        isActive: row.isActive !== false,
      } satisfies ProductUnitConversionDraft;
    })
    .filter((entry): entry is ProductUnitConversionDraft => Boolean(entry));
}

function buildUnitOptions(
  entries: UnitDictionaryEntry[] | undefined,
): UnitOption[] {
  const list = Array.isArray(entries) ? entries : [];
  const options = list
    .map((entry) => {
      const value = normalizeText(entry.value);
      if (!value) return null;
      return {
        value,
        label: normalizeText(entry.label) ?? value,
      } satisfies UnitOption;
    })
    .filter((entry): entry is UnitOption => Boolean(entry));
  return options.sort((left, right) => left.label.localeCompare(right.label));
}

export function ProductUomSection({
  values,
  errors,
  setValue,
  embedded = false,
}: ProductUomSectionProps) {
  const t = useT();
  const [unitOptions, setUnitOptions] = React.useState<UnitOption[]>([]);
  const [loadingUnits, setLoadingUnits] = React.useState(false);
  const conversions = React.useMemo(
    () => normalizeConversions(values.unitConversions),
    [values.unitConversions],
  );

  React.useEffect(() => {
    let cancelled = false;
    async function loadUnits() {
      setLoadingUnits(true);
      try {
        const response = await apiCall<UnitDictionaryResponse>(
          "/api/catalog/dictionaries/unit",
          undefined,
          { fallback: { entries: [] } },
        );
        if (cancelled) return;
        setUnitOptions(buildUnitOptions(response.result?.entries));
      } catch {
        if (!cancelled) setUnitOptions([]);
      } finally {
        if (!cancelled) setLoadingUnits(false);
      }
    }
    void loadUnits();
    return () => {
      cancelled = true;
    };
  }, []);

  const findUnitLabel = React.useCallback(
    (value: string | null | undefined) => {
      const code = normalizeText(value);
      if (!code) return null;
      const option = unitOptions.find((entry) => entry.value === code);
      return option?.label ?? code;
    },
    [unitOptions],
  );

  const setConversions = React.useCallback(
    (next: ProductUnitConversionDraft[]) => {
      setValue("unitConversions", next);
    },
    [setValue],
  );

  const addConversion = React.useCallback(() => {
    const next = [
      ...conversions,
      createProductUnitConversionDraft({
        sortOrder: String((conversions.length + 1) * 10),
      }),
    ];
    setConversions(next);
  }, [conversions, setConversions]);

  const updateConversion = React.useCallback(
    (index: number, patch: Partial<ProductUnitConversionDraft>) => {
      const next = conversions.map((entry, rowIndex) =>
        rowIndex === index ? { ...entry, ...patch } : entry,
      );
      setConversions(next);
    },
    [conversions, setConversions],
  );

  const removeConversion = React.useCallback(
    (index: number) => {
      const next = conversions.filter((_entry, rowIndex) => rowIndex !== index);
      setConversions(next);
    },
    [conversions, setConversions],
  );

  const defaultUnit = normalizeText(values.defaultUnit) ?? "";
  const defaultSalesUnit = normalizeText(values.defaultSalesUnit) ?? "";
  const defaultSalesQuantity =
    normalizeText(values.defaultSalesUnitQuantity) ?? "1";
  const unitPriceEnabled = Boolean(values.unitPriceEnabled);
  const unitPriceReferenceUnit =
    normalizeText(values.unitPriceReferenceUnit) ?? "";
  const unitPriceBaseQuantity =
    normalizeText(values.unitPriceBaseQuantity) ?? "";

  const conversionPreview = conversions
    .filter(
      (entry) =>
        normalizeText(entry.unitCode) && normalizeText(entry.toBaseFactor),
    )
    .slice(0, 3)
    .map((entry) => {
      const label = findUnitLabel(entry.unitCode) ?? entry.unitCode;
      const baseLabel = findUnitLabel(defaultUnit) ?? defaultUnit;
      const factor = normalizeText(entry.toBaseFactor) ?? "1";
      return `1 ${label} = ${factor} ${baseLabel || t("catalog.products.uom.baseUnit", "base unit")}`;
    })
    .join(" • ");

  return (
    <div
      className={
        embedded ? "space-y-5" : "space-y-5 rounded-lg border bg-card p-4"
      }
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">
          {t("catalog.products.uom.title", "Units of measure")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t(
            "catalog.products.uom.description",
            "Set base/sales units and packaging conversions.",
          )}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{t("catalog.products.uom.baseUnit", "Base unit")}</Label>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={defaultUnit}
            onChange={(event) =>
              setValue("defaultUnit", event.target.value || null)
            }
            disabled={loadingUnits}
          >
            <option value="">
              {t("catalog.products.uom.selectUnit", "Select unit")}
            </option>
            {unitOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors.defaultUnit ? (
            <p className="text-xs text-red-600">{errors.defaultUnit}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label>
            {t("catalog.products.uom.defaultSalesUnit", "Default sales unit")}
          </Label>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={defaultSalesUnit}
            onChange={(event) =>
              setValue("defaultSalesUnit", event.target.value || null)
            }
            disabled={loadingUnits}
          >
            <option value="">
              {t("catalog.products.uom.selectUnit", "Select unit")}
            </option>
            {unitOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors.defaultSalesUnit ? (
            <p className="text-xs text-red-600">{errors.defaultSalesUnit}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label>
            {t(
              "catalog.products.uom.defaultSalesQuantity",
              "Default sales quantity",
            )}
          </Label>
          <Input
            type="number"
            min="0.000001"
            step="0.000001"
            value={defaultSalesQuantity}
            onChange={(event) =>
              setValue("defaultSalesUnitQuantity", event.target.value)
            }
            placeholder="1"
          />
          {errors.defaultSalesUnitQuantity ? (
            <p className="text-xs text-red-600">
              {errors.defaultSalesUnitQuantity}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="catalog-product-unit-price-enabled"
            checked={unitPriceEnabled}
            onCheckedChange={(checked) =>
              setValue("unitPriceEnabled", checked === true)
            }
          />
          <Label
            htmlFor="catalog-product-unit-price-enabled"
            className="text-sm"
          >
            {t(
              "catalog.products.unitPrice.enable",
              "Enable EU unit price display",
            )}
          </Label>
        </div>

        {unitPriceEnabled ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>
                {t(
                  "catalog.products.unitPrice.referenceUnit",
                  "Reference unit",
                )}
              </Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={unitPriceReferenceUnit}
                onChange={(event) =>
                  setValue("unitPriceReferenceUnit", event.target.value || null)
                }
              >
                <option value="">
                  {t(
                    "catalog.products.unitPrice.selectReferenceUnit",
                    "Select reference unit",
                  )}
                </option>
                <option value="kg">1 kg</option>
                <option value="l">1 l</option>
                <option value="m2">1 m²</option>
                <option value="m3">1 m³</option>
                <option value="pc">1 pc</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>
                {t(
                  "catalog.products.unitPrice.baseQuantity",
                  "Base quantity for reference",
                )}
              </Label>
              <Input
                type="number"
                min="0.000001"
                step="0.000001"
                value={unitPriceBaseQuantity}
                onChange={(event) =>
                  setValue("unitPriceBaseQuantity", event.target.value)
                }
                placeholder="1"
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">
            {t("catalog.products.uom.conversions", "Product conversions")}
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addConversion}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t("catalog.products.uom.addConversion", "Add conversion")}
          </Button>
        </div>

        {conversions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t(
              "catalog.products.uom.emptyConversions",
              "No conversions configured yet.",
            )}
          </p>
        ) : (
          <div className="space-y-2">
            {conversions.map((entry, index) => (
              <div
                key={entry.id ?? `uom-conversion-${index}`}
                className="grid gap-2 rounded border p-2 md:grid-cols-12 md:items-center"
              >
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:col-span-4"
                  value={entry.unitCode}
                  onChange={(event) =>
                    updateConversion(index, { unitCode: event.target.value })
                  }
                  disabled={loadingUnits}
                >
                  <option value="">
                    {t("catalog.products.uom.selectUnit", "Select unit")}
                  </option>
                  {unitOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <Input
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  className="md:col-span-3"
                  value={entry.toBaseFactor}
                  onChange={(event) =>
                    updateConversion(index, {
                      toBaseFactor: event.target.value,
                    })
                  }
                  placeholder={t(
                    "catalog.products.uom.toBaseFactor",
                    "To base factor",
                  )}
                />

                <Input
                  type="number"
                  min="0"
                  step="1"
                  className="md:col-span-2"
                  value={entry.sortOrder}
                  onChange={(event) =>
                    updateConversion(index, { sortOrder: event.target.value })
                  }
                  placeholder={t("catalog.products.uom.sortOrder", "Sort")}
                />

                <label className="flex items-center gap-2 px-2 text-xs text-muted-foreground md:col-span-2 md:justify-center">
                  <Checkbox
                    checked={entry.isActive}
                    onCheckedChange={(checked) =>
                      updateConversion(index, { isActive: checked === true })
                    }
                  />
                  {t("catalog.products.uom.active", "Active")}
                </label>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive md:col-span-1 md:justify-self-end"
                  onClick={() => removeConversion(index)}
                  aria-label={t(
                    "catalog.products.uom.removeConversion",
                    "Remove conversion",
                  )}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {conversionPreview ? (
          <p className="text-xs text-muted-foreground">{conversionPreview}</p>
        ) : null}
      </div>
    </div>
  );
}
