type ShippedLineSnapshot = {
  quantity: number;
  totalNetAmount?: number | null;
  totalGrossAmount?: number | null;
};

const SHIPPED_LINE_IMMUTABLE_PAYLOAD_FIELDS = [
  "kind",
  "productId",
  "productVariantId",
  "quantityUnit",
  "unitPriceNet",
  "unitPriceGross",
  "priceId",
  "priceMode",
  "taxRateId",
  "taxRate",
  "taxAmount",
  "discountAmount",
  "discountPercent",
  "catalogSnapshot",
  "metadata",
] as const;

function scaleTotal(
  total: number | null | undefined,
  previousQuantity: number,
  nextQuantity: number,
): number | undefined {
  if (
    !Number.isFinite(total) ||
    !Number.isFinite(previousQuantity) ||
    previousQuantity <= 0
  ) {
    return undefined;
  }
  return (total as number) * (nextQuantity / previousQuantity);
}

export function prepareShippedLineUpdatePayload(
  payload: Record<string, unknown>,
  currentLine: ShippedLineSnapshot | null,
): Record<string, unknown> {
  if (!currentLine) return payload;

  const nextPayload = { ...payload };
  for (const field of SHIPPED_LINE_IMMUTABLE_PAYLOAD_FIELDS) {
    delete nextPayload[field];
  }

  delete nextPayload.totalNetAmount;
  delete nextPayload.totalGrossAmount;

  const nextQuantity = Number(nextPayload.quantity);
  if (!Number.isFinite(nextQuantity) || nextQuantity === currentLine.quantity) {
    return nextPayload;
  }

  const scaledNetTotal = scaleTotal(
    currentLine.totalNetAmount,
    currentLine.quantity,
    nextQuantity,
  );
  const scaledGrossTotal = scaleTotal(
    currentLine.totalGrossAmount,
    currentLine.quantity,
    nextQuantity,
  );
  if (scaledNetTotal !== undefined) nextPayload.totalNetAmount = scaledNetTotal;
  if (scaledGrossTotal !== undefined)
    nextPayload.totalGrossAmount = scaledGrossTotal;

  return nextPayload;
}
