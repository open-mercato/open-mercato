import { NextResponse } from "next/server";
import { z } from "zod";
import { createRequestContainer } from "@open-mercato/shared/lib/di/container";
import { resolveTranslations } from "@open-mercato/shared/lib/i18n/server";
import { CrudHttpError } from "@open-mercato/shared/lib/crud/errors";
import type { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi";
import type { EntityManager } from "@mikro-orm/postgresql";
import { findOneWithDecryption, findWithDecryption } from "@open-mercato/shared/lib/encryption/find";
import {
  SalesQuote,
  SalesQuoteLine,
  SalesQuoteAdjustment,
} from "../../../../data/entities";
import { canonicalizeUnitCode } from "@open-mercato/shared/lib/units/unitCodes";

const paramsSchema = z.object({
  token: z.string().uuid(),
});

export const metadata = {
  GET: { requireAuth: false },
};

export async function GET(_req: Request, ctx: { params: { token: string } }) {
  try {
    const { token } = paramsSchema.parse(ctx.params ?? {});
    const container = await createRequestContainer();
    const em = container.resolve("em") as EntityManager;
    const quote = await findOneWithDecryption(em, SalesQuote, {
      acceptanceToken: token,
      deletedAt: null,
    });
    const { translate } = await resolveTranslations();
    if (!quote) {
      throw new CrudHttpError(404, {
        error: translate("sales.quotes.public.notFound", "Quote not found."),
      });
    }

    const now = new Date();
    const isExpired =
      !!quote.validUntil && quote.validUntil.getTime() < now.getTime();

    const [lines, adjustments] = await Promise.all([
      findWithDecryption(
        em,
        SalesQuoteLine,
        { quote: quote.id, organizationId: quote.organizationId, tenantId: quote.tenantId, deletedAt: null },
        { orderBy: { lineNumber: "asc" } },
      ),
      findWithDecryption(
        em,
        SalesQuoteAdjustment,
        { quote: quote.id, organizationId: quote.organizationId, tenantId: quote.tenantId },
        { orderBy: { position: "asc" } },
      ),
    ]);

    return NextResponse.json({
      quote: {
        quoteNumber: quote.quoteNumber,
        currencyCode: quote.currencyCode,
        validFrom: quote.validFrom?.toISOString() ?? null,
        validUntil: quote.validUntil?.toISOString() ?? null,
        status: quote.status ?? null,
        subtotalNetAmount: quote.subtotalNetAmount,
        subtotalGrossAmount: quote.subtotalGrossAmount,
        discountTotalAmount: quote.discountTotalAmount,
        taxTotalAmount: quote.taxTotalAmount,
        grandTotalNetAmount: quote.grandTotalNetAmount,
        grandTotalGrossAmount: quote.grandTotalGrossAmount,
      },
      lines: lines.map((line) => ({
        quantityUnit: canonicalizeUnitCode(line.quantityUnit) ?? null,
        normalizedUnit:
          canonicalizeUnitCode(line.normalizedUnit ?? line.quantityUnit) ??
          null,
        lineNumber: line.lineNumber ?? null,
        kind: line.kind,
        name: line.name ?? null,
        description: line.description ?? null,
        quantity: line.quantity,
        normalizedQuantity: line.normalizedQuantity ?? line.quantity,
        uomSnapshot: line.uomSnapshot
          ? {
              baseUnitCode: line.uomSnapshot.baseUnitCode ?? null,
              enteredUnitCode: line.uomSnapshot.enteredUnitCode ?? null,
            }
          : null,
        currencyCode: line.currencyCode,
        unitPriceNet: line.unitPriceNet,
        unitPriceGross: line.unitPriceGross,
        discountAmount: line.discountAmount,
        discountPercent: line.discountPercent,
        taxRate: line.taxRate,
        taxAmount: line.taxAmount,
        totalNetAmount: line.totalNetAmount,
        totalGrossAmount: line.totalGrossAmount,
        unitPriceReference: (() => {
          if (!line.uomSnapshot) return null;
          const ref = line.uomSnapshot.unitPriceReference;
          if (!ref) return null;
          return {
            enabled: ref.enabled ?? null,
            referenceUnitCode: ref.referenceUnitCode ?? null,
            baseQuantity: ref.baseQuantity ?? null,
            grossPerReference: ref.grossPerReference ?? null,
            netPerReference: ref.netPerReference ?? null,
          };
        })(),
      })),
      adjustments: adjustments.map((adj) => ({
        scope: adj.scope,
        kind: adj.kind,
        label: adj.label ?? adj.code ?? null,
        rate: adj.rate,
        amountNet: adj.amountNet,
        amountGross: adj.amountGross,
        currencyCode: adj.currencyCode ?? null,
        position: adj.position ?? null,
        quoteLineId: adj.quoteLine?.id ?? null,
      })),
      isExpired,
    });
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    const { translate } = await resolveTranslations();
    console.error("sales.quotes.public failed", err);
    return NextResponse.json(
      {
        error: translate("sales.quotes.public.failed", "Failed to load quote."),
      },
      { status: 400 },
    );
  }
}

const publicQuoteResponseSchema = z.object({
  quote: z.object({
    quoteNumber: z.string(),
    currencyCode: z.string(),
    validFrom: z.string().nullable(),
    validUntil: z.string().nullable(),
    status: z.string().nullable(),
    subtotalNetAmount: z.string(),
    subtotalGrossAmount: z.string(),
    discountTotalAmount: z.string(),
    taxTotalAmount: z.string(),
    grandTotalNetAmount: z.string(),
    grandTotalGrossAmount: z.string(),
  }),
  lines: z.array(
    z.object({
      lineNumber: z.number().nullable(),
      kind: z.string(),
      name: z.string().nullable(),
      description: z.string().nullable(),
      quantity: z.string(),
      quantityUnit: z.string().nullable(),
      normalizedQuantity: z.string(),
      normalizedUnit: z.string().nullable(),
      uomSnapshot: z
        .object({
          baseUnitCode: z.string().nullable(),
          enteredUnitCode: z.string().nullable(),
        })
        .nullable()
        .optional(),
      currencyCode: z.string(),
      unitPriceNet: z.string(),
      unitPriceGross: z.string(),
      discountAmount: z.string(),
      discountPercent: z.string(),
      taxRate: z.string(),
      taxAmount: z.string(),
      totalNetAmount: z.string(),
      totalGrossAmount: z.string(),
      unitPriceReference: z
        .record(z.string(), z.unknown())
        .nullable()
        .optional(),
    }),
  ),
  adjustments: z.array(
    z.object({
      scope: z.string().nullable(),
      kind: z.string().nullable(),
      label: z.string().nullable(),
      rate: z.string().nullable(),
      amountNet: z.string().nullable(),
      amountGross: z.string().nullable(),
      currencyCode: z.string().nullable(),
      position: z.number().nullable(),
      quoteLineId: z.string().uuid().nullable(),
    }),
  ),
  isExpired: z.boolean(),
});

export const openApi: OpenApiRouteDoc = {
  tag: "Sales",
  summary: "View a quote (public)",
  pathParams: z.object({ token: z.string().uuid() }),
  methods: {
    GET: {
      summary: "Get quote details by acceptance token",
      responses: [
        {
          status: 200,
          description: "Quote details",
          schema: publicQuoteResponseSchema,
        },
        {
          status: 404,
          description: "Quote not found",
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
};
