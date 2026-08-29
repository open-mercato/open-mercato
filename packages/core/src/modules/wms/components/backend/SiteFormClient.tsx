"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CrudForm,
  type CrudField,
  type CrudFormGroup,
} from "@open-mercato/ui/backend/CrudForm";
import {
  ErrorMessage,
  LoadingMessage,
  RecordNotFoundState,
} from "@open-mercato/ui/backend/detail";
import { flash } from "@open-mercato/ui/backend/FlashMessages";
import { useGuardedMutation } from "@open-mercato/ui/backend/injection/useGuardedMutation";
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall";
import {
  createCrud,
  updateCrud,
} from "@open-mercato/ui/backend/utils/crud";
import { raiseCrudError } from "@open-mercato/ui/backend/utils/serverErrors";
import { extractCustomFieldEntries } from "@open-mercato/shared/lib/crud/custom-fields-client";
import { useT } from "@open-mercato/shared/lib/i18n/context";
import { E } from "#generated/entities.ids.generated";
import { flashMutationError } from "../../lib/flashMutationError";
import { SiteWarehouseRolesClient } from "./SiteWarehouseRolesClient";
import {
  loadFirstSite,
  buildSiteSubmitPayload,
  createSiteSchema,
  type Paged,
  type Site,
  type SiteFormValues,
  useCanManageSites,
} from "./wmsSitesShared";

function buildSiteGroups(siteId?: string): CrudFormGroup[] {
  const groups: CrudFormGroup[] = [
    {
      id: "details",
      title: "wms.sites.form.details",
      column: 1,
      fields: ["code", "name", "isActive"],
    },
  ];

  if (siteId) {
    groups.push({
      id: "warehouseRoles",
      column: 1,
      component: () => <SiteWarehouseRolesClient siteId={siteId} embedded />,
    });
  }

  groups.push({ id: "custom", column: 2, kind: "customFields" });
  return groups;
}

export function SiteFormClient({ siteId }: { siteId?: string }) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canManage = useCanManageSites();
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    retryLastMutation: () => Promise<boolean>;
  }>({
    contextId: "wms-site-form",
  });
  const query = useQuery({
    enabled: Boolean(siteId),
    queryKey: ["wms-site", siteId],
    queryFn: async () => {
      const call = await apiCall<Paged<Site>>(
        `/api/wms/sites?ids=${encodeURIComponent(siteId ?? "")}`,
        { cache: "no-store" },
      );
      if (!call.ok)
        await raiseCrudError(
          call.response,
          t("wms.sites.errors.load", "Failed to load site."),
        );
      return loadFirstSite(call.result);
    },
  });
  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: "code",
        label: t("wms.sites.form.code", "Code"),
        type: "text",
        required: true,
      },
      {
        id: "name",
        label: t("wms.sites.form.name", "Name"),
        type: "text",
        required: true,
      },
      {
        id: "isActive",
        label: t("wms.sites.form.active", "Active"),
        type: "checkbox",
      },
    ],
    [t],
  );
  const schema = React.useMemo(() => createSiteSchema(t), [t]);
  const groups = React.useMemo(() => buildSiteGroups(siteId), [siteId]);
  if (siteId && query.isLoading)
    return <LoadingMessage label={t("wms.sites.loading", "Loading site…")} />;
  if (query.isError)
    return (
      <ErrorMessage
        label={t("wms.sites.errors.load", "Failed to load site.")}
      />
    );
  if (siteId && !query.data)
    return (
      <RecordNotFoundState
        label={t("wms.sites.errors.notFound", "Site not found.")}
        backHref="/backend/wms/sites"
      />
    );
  const initialValues: SiteFormValues = query.data
    ? {
        id: query.data.id,
        code: query.data.code ?? "",
        name: query.data.name ?? "",
        isActive: query.data.isActive,
        updatedAt: query.data.updatedAt,
        ...extractCustomFieldEntries(query.data as Record<string, unknown>),
      }
    : { code: "", name: "", isActive: true };
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <CrudForm<SiteFormValues>
        title={
          siteId
            ? t("wms.sites.edit", "Edit site")
            : t("wms.sites.create", "Create site")
        }
        schema={schema}
        fields={fields}
        groups={groups}
        contentMinHeight="none"
        entityId={E.wms.site}
        entityIds={[E.wms.site]}
        initialValues={initialValues}
        submitLabel={
          siteId
            ? t("wms.sites.update", "Save changes")
            : t("wms.sites.create", "Create site")
        }
        readOnly={!canManage}
        backHref="/backend/wms/sites"
        cancelHref="/backend/wms/sites"
        onSubmit={async (values) => {
          const payload = buildSiteSubmitPayload(siteId, values);
          try {
            const result = await runMutation({
              operation: () =>
                siteId
                  ? updateCrud("wms/sites", payload, {
                      errorMessage: t(
                        "wms.sites.errors.save",
                        "Failed to save site.",
                      ),
                    })
                  : createCrud<{ id: string | null }>("wms/sites", payload, {
                      errorMessage: t(
                        "wms.sites.errors.save",
                        "Failed to save site.",
                      ),
                    }),
              context: { retryLastMutation },
              mutationPayload: payload,
            });
            flash(t("wms.sites.flash.saved", "Site saved."), "success");
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["wms-sites"] }),
              ...(siteId
                ? [
                    queryClient.invalidateQueries({
                      queryKey: ["wms-site", siteId],
                    }),
                  ]
                : []),
            ]);
            const createdId =
              !siteId && result?.result?.id ? result.result.id : null;
            router.push(
              siteId
                ? `/backend/wms/sites/${siteId}`
                : createdId
                  ? `/backend/wms/sites/${createdId}`
                  : "/backend/wms/sites",
            );
          } catch (error) {
            flashMutationError(
              error,
              t("wms.sites.errors.save", "Failed to save site."),
              t,
            );
            throw error;
          }
        }}
      />
    </div>
  );
}
