"use client";
import * as React from "react";
import { Input } from "@open-mercato/ui/primitives/input";
import { Button } from "@open-mercato/ui/primitives/button";
import { useT } from "@/lib/i18n/context";
import { apiCall } from "@open-mercato/ui/backend/utils/apiCall";
import { flash } from "@open-mercato/ui/backend/FlashMessages";

type SettingsResponse = {
  apiKey: string;
  apiBaseUrl: string;
};

type FormState = {
  apiKey: string;
  apiBaseUrl: string;
};

const DEFAULT_STATE: FormState = {
  apiKey: "",
  apiBaseUrl: "",
};

const normalizeState = (
  payload?: Partial<SettingsResponse> | null
): FormState => ({
  apiKey:
    typeof payload?.apiKey === "string" && payload.apiKey.trim().length
      ? payload.apiKey
      : "",
  apiBaseUrl: typeof payload?.apiBaseUrl === "string" && payload.apiBaseUrl.trim().length
    ? payload.apiBaseUrl
    : "",

});

export default function FreighttechTrackingSettings() {
  const t = useT();
  const [formState, setFormState] = React.useState<FormState>(DEFAULT_STATE);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setSaving(true);
      try {
        const payload = {
          apiKey: formState.apiKey.trim(),
          apiBaseUrl: formState.apiBaseUrl.trim(),
        };
        const call = await apiCall<SettingsResponse>(
          "/api/fms_tracking/settings/freighttech",
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }
        );
        if (!call.ok) {
          flash(t("fms_tracking.settings.errors.save"), "error");
          return;
        }
        setFormState(normalizeState(call.result));
        flash(t("fms_tracking.settings.messages.saved"), "success");
      } catch (err) {
        console.error("fms_tracking.settings.save failed", err);
        flash(t("fms_tracking.settings.errors.save"), "error");
      } finally {
        setSaving(false);
      }
    },
    [formState.apiKey, formState.apiBaseUrl, t]
  );

  const handleChange =
    (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) => {
      setFormState((prev) => ({ ...prev, [key]: event.target.value }));
    };

  const handleLoad = React.useCallback(async () => {
    setLoading(true);
    try {
      const call = await apiCall<SettingsResponse>(
        "/api/fms_tracking/settings/freighttech"
      );
      if (call.ok) {
        setFormState(normalizeState(call.result));
      } else {
        flash(t("fms_tracking.settings.errors.load"), "error");
      }
    } catch (err) {
      console.error("fms_tracking.settings.load failed", err);
      flash(t("fms_tracking.settings.errors.load"), "error");
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleReset = React.useCallback(() => {
    setFormState(DEFAULT_STATE);
    void handleLoad();
  }, [handleLoad]);

  React.useEffect(() => {
    void handleLoad();
  }, [handleLoad]);

  return (
        <section className="rounded-lg border bg-card/30 p-5 shadow-sm">
          <h2 className="text-xl font-semibold">FreightTech.org</h2>
          <form className="mt-4 space-y-5" onSubmit={handleSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <div className="text-sm font-medium">
                  {t("fms_tracking.settings.api_key.label")}
                </div>
                <Input
                  value={formState.apiKey}
                  onChange={handleChange("apiKey")}
                  disabled={loading || saving}
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  {t("fms_tracking.settings.api_key.hint")}
                </p>
              </label>

              <label className="space-y-2">
                <div className="text-sm font-medium">
                  {t("fms_tracking.settings.api_base_url.label")}
                </div>
                <Input
                  value={formState.apiBaseUrl}
                  onChange={handleChange("apiBaseUrl")}
                  disabled={loading || saving}
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  {t("fms_tracking.settings.api_base_url.hint")}
                </p>
              </label>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={handleReset}
                disabled={loading || saving}
              >
                {t("fms_tracking.settings.actions.reset")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving
                  ? t("fms_tracking.settings.actions.saving")
                  : t("fms_tracking.settings.actions.save")}
              </Button>
            </div>
          </form>
        </section>
  );
}
