"use client";

import { z } from "zod";
import { useBackendChrome } from "@open-mercato/ui/backend/BackendChromeProvider";
import { hasFeature } from "@open-mercato/shared/security/features";

type Translate = (key: string, fallback?: string) => string;

export type Site = {
  id: string;
  code: string | null;
  name: string | null;
  isActive: boolean;
  updatedAt: string | null;
  customValues?: Record<string, unknown>;
};

export type Paged<T> = {
  items: T[];
  total: number;
  totalPages: number;
  totalIsCapped?: boolean;
};

export type SiteFormValues = {
  id?: string;
  code: string;
  name: string;
  isActive: boolean;
  updatedAt?: string | null;
  [key: string]: unknown;
};

export function createSiteSchema(t: Translate) {
  return z
  .object({
    code: z
      .string()
      .trim()
      .min(1, t("wms.sites.validation.code", "Enter a code between 1 and 80 characters."))
      .max(80, t("wms.sites.validation.code", "Enter a code between 1 and 80 characters.")),
    name: z
      .string()
      .trim()
      .min(1, t("wms.sites.validation.name", "Enter a name between 1 and 200 characters."))
      .max(200, t("wms.sites.validation.name", "Enter a name between 1 and 200 characters.")),
    isActive: z.boolean().default(true),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough();
}

export function loadFirstSite(payload: unknown): Site | null {
  const items = (payload as Paged<Site> | null)?.items;
  return Array.isArray(items) && items[0]?.id ? items[0] : null;
}

export function buildSiteSubmitPayload(
  siteId: string | undefined,
  values: SiteFormValues,
): Record<string, unknown> {
  if (siteId) return { ...values, id: siteId };
  const { id: _id, updatedAt: _updatedAt, ...createValues } = values;
  return createValues;
}

export const SITE_WAREHOUSE_ROLES_PAGE_SIZE = 100;

export function buildSiteWarehouseRolesListPath(siteId: string, page: number): string {
  return `/api/wms/site-warehouse-roles?siteId=${encodeURIComponent(siteId)}&page=${page}&pageSize=${SITE_WAREHOUSE_ROLES_PAGE_SIZE}&sortField=role&sortDir=asc`;
}

export function buildSiteWarehouseRoleDefaultsListPath(siteId: string): string {
  return `/api/wms/site-warehouse-roles?siteId=${encodeURIComponent(siteId)}&isDefault=true&page=1&pageSize=100&sortField=role&sortDir=asc`;
}

export function useCanManageSites() {
  const { payload, isReady } = useBackendChrome();
  return isReady && hasFeature(payload?.grantedFeatures, "wms.manage_sites");
}
