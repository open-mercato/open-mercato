"use client";

import * as React from "react";
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall";
import { deleteCrud } from "@open-mercato/ui/backend/utils/crud";
import { normalizeCrudServerError } from "@open-mercato/ui/backend/utils/serverErrors";
import { LoadingMessage, TabEmptyState } from "@open-mercato/ui/backend/detail";
import { Button } from "@open-mercato/ui/primitives/button";
import { flash } from "@open-mercato/ui/backend/FlashMessages";
import { Pencil, Trash2 } from "lucide-react";
import {
  DictionaryValue,
  type DictionaryMap,
  createDictionaryMap,
  normalizeDictionaryEntries,
} from "@open-mercato/core/modules/dictionaries/components/dictionaryAppearance";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { useOrganizationScopeDetail } from "@open-mercato/shared/lib/frontend/useOrganizationScope";
import { useConfirmDialog } from "@open-mercato/ui/backend/confirm-dialog";
import { emitSalesDocumentTotalsRefresh } from "@open-mercato/core/modules/sales/lib/frontend/documentTotalsEvents";
import { LineItemDialog } from "./LineItemDialog";
import type { SalesLineRecord } from "./lineItemTypes";
import { formatMoney, normalizeNumber } from "./lineItemUtils";
import type { SectionAction } from "@open-mercato/ui/backend/detail";
import { extractCustomFieldValues } from "./customFieldHelpers";
import { canonicalizeUnitCode } from "@open-mercato/shared/lib/units/unitCodes";
import type { SalesLineUomSnapshot } from "../../lib/types";

type ResolvedUnitPriceReference = {
  grossPerReference: number;
  referenceUnitCode: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSalesLineUomSnapshot(
  value: unknown,
): value is SalesLineUomSnapshot {
  if (!isPlainObject(value)) return false;
  return (
    value.version === 1 &&
    typeof value.enteredQuantity === "string" &&
    typeof value.toBaseFactor === "string" &&
    typeof value.normalizedQuantity === "string"
  );
}

function extractUomSnapshot(
  item: Record<string, unknown>,
): SalesLineUomSnapshot | null {
  const raw = item.uom_snapshot ?? item.uomSnapshot;
  if (isSalesLineUomSnapshot(raw)) return raw;
  return null;
}

function resolveUnitPriceReference(
  snapshot: SalesLineUomSnapshot | Record<string, unknown> | null,
): ResolvedUnitPriceReference | null {
  if (!snapshot) return null;

  const ref = isSalesLineUomSnapshot(snapshot)
    ? snapshot.unitPriceReference
    : isPlainObject(snapshot)
      ? isPlainObject(snapshot.unitPriceReference)
        ? snapshot.unitPriceReference
        : isPlainObject(snapshot.unit_price_reference)
          ? snapshot.unit_price_reference
          : null
      : null;

  if (!ref || !isPlainObject(ref)) return null;

  const r = ref as Record<string, unknown>;
  const grossPerReference = normalizeNumber(
    r.grossPerReference ?? r.gross_per_reference,
    Number.NaN,
  );
  if (!Number.isFinite(grossPerReference)) return null;

  const referenceUnitCode =
    typeof r.referenceUnitCode === "string"
      ? r.referenceUnitCode
      : typeof r.reference_unit_code === "string"
        ? r.reference_unit_code
        : typeof r.referenceUnit === "string"
          ? r.referenceUnit
          : null;
  if (!referenceUnitCode) return null;

  return { grossPerReference, referenceUnitCode };
}

function getUomFields(item: Record<string, unknown>) {
  const uomSnapshot = extractUomSnapshot(item);
  return {
    normalizedQuantity: (item.normalized_quantity ?? item.normalizedQuantity ?? null) as
      | number
      | string
      | null,
    normalizedUnit: (item.normalized_unit ?? item.normalizedUnit ?? null) as string | null,
    quantityUnit: (item.quantity_unit ?? item.quantityUnit ?? null) as string | null,
    uomSnapshot,
  };
}

type SalesDocumentItemsSectionProps = {
  documentId: string;
  kind: "order" | "quote";
  currencyCode: string | null | undefined;
  organizationId?: string | null;
  tenantId?: string | null;
  onActionChange?: (action: SectionAction | null) => void;
  onItemsChange?: (items: SalesLineRecord[]) => void;
};

export function SalesDocumentItemsSection({
  documentId,
  kind,
  currencyCode,
  organizationId: orgFromProps,
  tenantId: tenantFromProps,
  onActionChange,
  onItemsChange,
}: SalesDocumentItemsSectionProps) {
  const t = useT();
  const { organizationId, tenantId } = useOrganizationScopeDetail();
  const { confirm, ConfirmDialogElement } = useConfirmDialog();
  const resolvedOrganizationId = orgFromProps ?? organizationId ?? null;
  const resolvedTenantId = tenantFromProps ?? tenantId ?? null;
  const [items, setItems] = React.useState<SalesLineRecord[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [lineForEdit, setLineForEdit] = React.useState<SalesLineRecord | null>(
    null,
  );
  const [lineStatusMap, setLineStatusMap] = React.useState<DictionaryMap>({});
  const [shippedTotals, setShippedTotals] = React.useState<Map<string, number>>(
    new Map(),
  );

  const resourcePath = React.useMemo(
    () => (kind === "order" ? "sales/order-lines" : "sales/quote-lines"),
    [kind],
  );
  const documentKey = kind === "order" ? "orderId" : "quoteId";
  const lineStatusesLoaded = React.useRef(false);
  const itemsLoadedForDocument = React.useRef<string | null>(null);
  const shipmentsLoadedForDocument = React.useRef<string | null>(null);
  const loadLineStatuses = React.useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "100" });
      const response = await apiCall<{
        items?: Array<Record<string, unknown>>;
      }>(`/api/sales/order-line-statuses?${params.toString()}`, undefined, {
        fallback: { items: [] },
      });
      const entries = normalizeDictionaryEntries(response.result?.items ?? []);
      setLineStatusMap(createDictionaryMap(entries));
    } catch (err) {
      console.error("sales.document.line-statuses.load", err);
      setLineStatusMap({});
    }
  }, []);

  const loadItems = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: "1",
        pageSize: "100",
        [documentKey]: documentId,
      });
      const response = await apiCall<{
        items?: Array<Record<string, unknown>>;
      }>(`/api/${resourcePath}?${params.toString()}`, undefined, {
        fallback: { items: [] },
      });
      if (response.ok && Array.isArray(response.result?.items)) {
        const mapped = response.result.items.flatMap<SalesLineRecord>(
          (item) => {
            const id = typeof item.id === "string" ? item.id : null;
            if (!id) return [];
            const taxRate = normalizeNumber(
              (item as any).tax_rate ?? (item as any).taxRate,
              0,
            );
            const customFields = extractCustomFieldValues(
              item as Record<string, unknown>,
            );
            const name =
              typeof item.name === "string"
                ? item.name
                : typeof item.catalog_snapshot === "object" &&
                    item.catalog_snapshot &&
                    typeof (item.catalog_snapshot as any).name === "string"
                  ? (item.catalog_snapshot as any).name
                  : null;
            const quantity = normalizeNumber(item.quantity, 0);
            const uomFields = getUomFields(item);
            const quantityUnit = canonicalizeUnitCode(uomFields.quantityUnit);
            const normalizedQuantity = normalizeNumber(
              uomFields.normalizedQuantity,
              quantity,
            );
            const normalizedUnit =
              canonicalizeUnitCode(uomFields.normalizedUnit) ?? quantityUnit;
            const uomSnapshot = uomFields.uomSnapshot;
            const unitPriceNetRaw = normalizeNumber(
              (item as any).unit_price_net ?? (item as any).unitPriceNet,
              Number.NaN,
            );
            const unitPriceGrossRaw = normalizeNumber(
              (item as any).unit_price_gross ?? (item as any).unitPriceGross,
              Number.NaN,
            );
            const unitPriceNet = Number.isFinite(unitPriceNetRaw)
              ? unitPriceNetRaw
              : Number.isFinite(unitPriceGrossRaw)
                ? unitPriceGrossRaw / (1 + taxRate / 100)
                : 0;
            const unitPriceGross = Number.isFinite(unitPriceGrossRaw)
              ? unitPriceGrossRaw
              : Number.isFinite(unitPriceNetRaw)
                ? unitPriceNetRaw * (1 + taxRate / 100)
                : 0;
            const totalNetRaw = normalizeNumber(
              (item as any).total_net_amount ?? (item as any).totalNetAmount,
              Number.NaN,
            );
            const totalGrossRaw = normalizeNumber(
              item.total_gross_amount ?? item.totalGrossAmount,
              Number.NaN,
            );
            const totalNet = Number.isFinite(totalNetRaw)
              ? totalNetRaw
              : unitPriceNet * quantity;
            const totalGross = Number.isFinite(totalGrossRaw)
              ? totalGrossRaw
              : unitPriceGross * quantity;
            const priceModeRaw =
              item.metadata &&
              typeof item.metadata === "object"
                ? (item.metadata as Record<string, unknown>).priceMode
                : null;
            const priceMode = priceModeRaw === "net" ? "net" : "gross";
            const customFieldSetId =
              typeof (item as any).custom_field_set_id === "string"
                ? (item as any).custom_field_set_id
                : typeof (item as any).customFieldSetId === "string"
                  ? (item as any).customFieldSetId
                  : null;
            const statusEntryId =
              typeof (item as any).status_entry_id === "string"
                ? (item as any).status_entry_id
                : typeof (item as any).statusEntryId === "string"
                  ? (item as any).statusEntryId
                  : null;
            const status = typeof item.status === "string" ? item.status : null;
            const record: SalesLineRecord = {
              id,
              name,
              productId:
                typeof item.product_id === "string" ? item.product_id : null,
              productVariantId:
                typeof item.product_variant_id === "string"
                  ? item.product_variant_id
                  : null,
              quantity,
              quantityUnit,
              normalizedQuantity,
              normalizedUnit,
              currencyCode:
                typeof item.currency_code === "string"
                  ? item.currency_code
                  : typeof currencyCode === "string"
                    ? currencyCode
                    : null,
              unitPriceNet,
              unitPriceGross,
              taxRate,
              totalNet,
              totalGross,
              priceMode,
              uomSnapshot,
              metadata:
                (item.metadata as Record<string, unknown> | null | undefined) ??
                null,
              catalogSnapshot:
                (item.catalog_snapshot as
                  | Record<string, unknown>
                  | null
                  | undefined) ?? null,
              customFieldSetId,
              customFields: Object.keys(customFields).length
                ? customFields
                : null,
              status,
              statusEntryId,
            };
            return [record];
          },
        );
        setItems(mapped);
        if (onItemsChange) onItemsChange(mapped);
      } else {
        setItems([]);
        if (onItemsChange) onItemsChange([]);
      }
    } catch (err) {
      console.error("sales.document.items.load", err);
      setError(t("sales.documents.items.errorLoad", "Failed to load items."));
      if (onItemsChange) onItemsChange([]);
    } finally {
      setLoading(false);
    }
  }, [currencyCode, documentId, documentKey, onItemsChange, resourcePath, t]);

  const loadShippedTotals = React.useCallback(async () => {
    if (kind !== "order") {
      setShippedTotals(new Map());
      return;
    }
    try {
      const params = new URLSearchParams({
        page: "1",
        pageSize: "100",
        orderId: documentId,
      });
      const response = await apiCall<{
        items?: Array<Record<string, unknown>>;
      }>(`/api/sales/shipments?${params.toString()}`, undefined, {
        fallback: { items: [] },
      });
      if (response.ok && Array.isArray(response.result?.items)) {
        const totals = new Map<string, number>();
        response.result.items.forEach((shipment) => {
          const entries = Array.isArray((shipment as any).items)
            ? ((shipment as any).items as Array<Record<string, unknown>>)
            : [];
          entries.forEach((entry) => {
            const lineId =
              typeof (entry as any).orderLineId === "string"
                ? (entry as any).orderLineId
                : typeof (entry as any).order_line_id === "string"
                  ? (entry as any).order_line_id
                  : null;
            if (!lineId) return;
            const quantity = normalizeNumber((entry as any).quantity, 0);
            if (!Number.isFinite(quantity) || quantity <= 0) return;
            const current = totals.get(lineId) ?? 0;
            totals.set(lineId, current + quantity);
          });
        });
        setShippedTotals(totals);
      } else {
        setShippedTotals(new Map());
      }
    } catch (err) {
      console.error("sales.document.shipments.load", err);
      setShippedTotals(new Map());
    }
  }, [documentId, kind]);

  React.useEffect(() => {
    if (lineStatusesLoaded.current) return;
    lineStatusesLoaded.current = true;
    void loadLineStatuses();
  }, [loadLineStatuses]);

  React.useEffect(() => {
    if (!documentId) return;
    if (itemsLoadedForDocument.current === documentId) return;
    itemsLoadedForDocument.current = documentId;
    void loadItems();
  }, [documentId, loadItems]);

  React.useEffect(() => {
    if (kind !== "order") {
      shipmentsLoadedForDocument.current = null;
      setShippedTotals(new Map());
      return;
    }
    const key = `${kind}:${documentId}`;
    if (shipmentsLoadedForDocument.current === key) return;
    shipmentsLoadedForDocument.current = key;
    void loadShippedTotals();
  }, [documentId, kind, loadShippedTotals]);

  const openCreate = React.useCallback(() => {
    setLineForEdit(null);
    setDialogOpen(true);
  }, []);

  React.useEffect(() => {
    if (!onActionChange) return;
    if (items.length === 0) {
      onActionChange(null);
      return;
    }
    onActionChange({
      label: t("sales.documents.items.add", "Add item"),
      onClick: openCreate,
      disabled: false,
    });
    return () => onActionChange(null);
  }, [items.length, onActionChange, openCreate, t]);

  const handleEdit = React.useCallback((line: SalesLineRecord) => {
    setLineForEdit(line);
    setDialogOpen(true);
  }, []);

  const resolveVariantInfo = React.useCallback((record: SalesLineRecord) => {
    const meta =
      (record.metadata as Record<string, unknown> | null | undefined) ?? null;
    const snapshot =
      (record.catalogSnapshot as Record<string, unknown> | null | undefined) ??
      null;
    const variantSnapshot =
      snapshot &&
      typeof snapshot.variant === "object" &&
      snapshot.variant
        ? (snapshot.variant as Record<string, unknown>)
        : null;
    const variantTitle =
      meta && typeof (meta as any).variantTitle === "string"
        ? (meta as any).variantTitle
        : variantSnapshot && typeof (variantSnapshot as any).name === "string"
          ? (variantSnapshot as any).name
          : null;
    const variantSku =
      meta && typeof (meta as any).variantSku === "string"
        ? (meta as any).variantSku
        : variantSnapshot && typeof (variantSnapshot as any).sku === "string"
          ? (variantSnapshot as any).sku
          : null;

    return { variantTitle, variantSku };
  }, []);

  const handleDelete = React.useCallback(
    async (line: SalesLineRecord) => {
      const confirmed = await confirm({
        title: t(
          "sales.documents.items.deleteConfirm",
          "Delete this line item?",
        ),
        variant: "destructive",
      });
      if (!confirmed) return;
      try {
        const result = await deleteCrud(resourcePath, {
          body: {
            id: line.id,
            [documentKey]: documentId,
            organizationId: resolvedOrganizationId ?? undefined,
            tenantId: resolvedTenantId ?? undefined,
          },
          errorMessage: t(
            "sales.documents.items.errorDelete",
            "Failed to delete line.",
          ),
        });
        if (result.ok) {
          flash(t("sales.documents.items.deleted", "Line removed."), "success");
          await loadItems();
          emitSalesDocumentTotalsRefresh({ documentId, kind });
        }
      } catch (err) {
        console.error("sales.document.items.delete", err);
        const normalized = normalizeCrudServerError(err);
        const fallback = t(
          "sales.documents.items.errorDelete",
          "Failed to delete line.",
        );
        flash(normalized.message || fallback, "error");
      }
    },
    [
      confirm,
      documentId,
      documentKey,
      kind,
      loadItems,
      resolvedOrganizationId,
      resourcePath,
      t,
      resolvedTenantId,
    ],
  );

  const renderStatus = React.useCallback(
    (line: SalesLineRecord) => {
      const value = line.status ?? null;
      if (!value) {
        return (
          <span className="text-xs text-muted-foreground">
            {t("sales.documents.items.table.statusEmpty", "No status")}
          </span>
        );
      }
      return (
        <DictionaryValue
          value={value}
          map={lineStatusMap}
          fallback={<span className="text-xs font-medium">{value}</span>}
          className="text-xs font-medium"
          iconWrapperClassName="inline-flex h-6 w-6 items-center justify-center rounded bg-muted text-muted-foreground"
          iconClassName="h-3.5 w-3.5"
          colorClassName="h-4 w-4 rounded-full border border-border/70"
        />
      );
    },
    [lineStatusMap, t],
  );

  const renderImage = (record: SalesLineRecord) => {
    const meta =
      (record.metadata as Record<string, unknown> | null | undefined) ?? {};
    const snapshot =
      (record.catalogSnapshot as Record<string, unknown> | null | undefined) ??
      {};
    const productSnapshot =
      typeof snapshot === "object" && snapshot
        ? ((snapshot as any).product ?? {})
        : {};
    const variantSnapshot =
      typeof snapshot === "object" && snapshot
        ? ((snapshot as any).variant ?? {})
        : {};
    const productThumb =
      (meta &&
        typeof meta.productThumbnail === "string" &&
        meta.productThumbnail) ||
      (productSnapshot &&
        typeof productSnapshot.thumbnailUrl === "string" &&
        productSnapshot.thumbnailUrl) ||
      null;
    const variantThumb =
      (meta &&
        typeof meta.variantThumbnail === "string" &&
        meta.variantThumbnail) ||
      (variantSnapshot &&
        typeof variantSnapshot.thumbnailUrl === "string" &&
        variantSnapshot.thumbnailUrl) ||
      null;
    const thumbnail = variantThumb ?? productThumb;
    if (thumbnail) {
      return (
        <img
          src={thumbnail}
          alt={record.name ?? record.id}
          className="h-10 w-10 rounded border object-cover"
        />
      );
    }
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded border bg-muted text-xs text-muted-foreground">
        N/A
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {loading ? (
        <LoadingMessage
          label={t("sales.documents.items.loading", "Loading items…")}
          className="border-0 bg-transparent p-0 py-8 justify-center"
        />
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : items.length === 0 ? (
        <TabEmptyState
          title={t("sales.documents.items.empty", "No items yet.")}
          description={t(
            "sales.documents.items.subtitle",
            "Add products and configure pricing for this document.",
          )}
          action={{
            label: t("sales.documents.items.add", "Add item"),
            onClick: openCreate,
          }}
        />
      ) : (
        <div className="overflow-hidden rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">
                  {t("sales.documents.items.table.product", "Product")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t("sales.documents.items.table.status", "Status")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t("sales.documents.items.table.quantity", "Qty")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t("sales.documents.items.table.unit", "Unit price")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t("sales.documents.items.table.total", "Total")}
                </th>
                <th className="px-3 py-2 font-medium sr-only">
                  {t("sales.documents.items.table.actions", "Actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const meta =
                  (item.metadata as
                    | Record<string, unknown>
                    | null
                    | undefined) ?? null;
                const { variantTitle, variantSku } = resolveVariantInfo(item);
                const productSku =
                  meta && typeof meta.productSku === "string"
                    ? meta.productSku
                    : null;
                const variantLabel = variantTitle ?? variantSku;
                const variantSuffix =
                  variantSku && variantLabel && variantSku !== variantLabel
                    ? ` • ${variantSku}`
                    : "";
                const showProductSku =
                  productSku && productSku !== variantSku ? productSku : null;
                const shippedQuantity = Math.max(
                  0,
                  shippedTotals.get(item.id) ?? 0,
                );
                const quantityLabel = item.quantityUnit
                  ? `${item.quantity} ${item.quantityUnit}`
                  : String(item.quantity);
                const showNormalized =
                  Number.isFinite(item.normalizedQuantity) &&
                  item.normalizedQuantity > 0 &&
                  (item.normalizedUnit ?? null) &&
                  (Math.abs(item.normalizedQuantity - item.quantity) >
                    0.000001 ||
                    (item.normalizedUnit ?? null) !==
                      (item.quantityUnit ?? null));
                const unitPriceReference = resolveUnitPriceReference(
                  item.uomSnapshot,
                );

                return (
                  <tr
                    key={item.id}
                    className="border-t hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => handleEdit(item)}
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        {renderImage(item)}
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {item.name ??
                              t("sales.documents.items.untitled", "Untitled")}
                          </div>
                          {variantLabel ? (
                            <div className="text-xs text-muted-foreground truncate">
                              {variantLabel}
                              {variantSuffix}
                            </div>
                          ) : null}
                          {showProductSku ? (
                            <div className="text-xs text-muted-foreground truncate">
                              {showProductSku}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center">
                        {renderStatus(item)}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">{quantityLabel}</span>
                        {showNormalized ? (
                          <span className="text-xs text-muted-foreground">
                            {item.normalizedQuantity} {item.normalizedUnit}
                          </span>
                        ) : null}
                        {shippedQuantity > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            {t(
                              "sales.documents.items.table.shipped",
                              "{{shipped}} / {{total}} shipped",
                              {
                                shipped: shippedQuantity,
                                total: item.quantity,
                              },
                            )}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-sm">
                          {formatMoney(
                            item.unitPriceGross,
                            item.currencyCode ?? currencyCode ?? undefined,
                          )}{" "}
                          <span className="text-xs text-muted-foreground">
                            {t("sales.documents.items.table.gross", "gross")}
                          </span>
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {formatMoney(
                            item.unitPriceNet,
                            item.currencyCode ?? currencyCode ?? undefined,
                          )}{" "}
                          {t("sales.documents.items.table.net", "net")}
                        </span>
                        {unitPriceReference ? (
                          <span className="text-xs text-muted-foreground">
                            {t(
                              "sales.documents.items.table.unitPriceReference",
                              "{{value}} per 1 {{unit}}",
                              {
                                value: formatMoney(
                                  unitPriceReference.grossPerReference,
                                  item.currencyCode ??
                                    currencyCode ??
                                    undefined,
                                ),
                                unit: unitPriceReference.referenceUnitCode,
                              },
                            )}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-semibold">
                      <div className="flex flex-col gap-0.5">
                        <span>
                          {formatMoney(
                            item.totalGross,
                            item.currencyCode ?? currencyCode ?? undefined,
                          )}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            {t("sales.documents.items.table.gross", "gross")}
                          </span>
                        </span>
                        <span className="text-xs font-medium text-muted-foreground">
                          {formatMoney(
                            item.totalNet,
                            item.currencyCode ?? currencyCode ?? undefined,
                          )}{" "}
                          {t("sales.documents.items.table.net", "net")}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleEdit(item);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDelete(item);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <LineItemDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) setLineForEdit(null);
        }}
        kind={kind}
        documentId={documentId}
        currencyCode={currencyCode}
        organizationId={resolvedOrganizationId}
        tenantId={resolvedTenantId}
        initialLine={lineForEdit}
        onSaved={async () => {
          await loadItems();
          emitSalesDocumentTotalsRefresh({ documentId, kind });
        }}
      />
      {ConfirmDialogElement}
    </div>
  );
}
