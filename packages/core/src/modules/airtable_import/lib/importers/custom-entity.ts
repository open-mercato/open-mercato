import type { ImportRecordInput, ImportRecordResult } from "./types";

interface CustomEntityInput extends ImportRecordInput {
  entitySlug: string;
}

export async function importCustomEntityRecord(
  input: CustomEntityInput,
): Promise<ImportRecordResult> {
  const {
    omId,
    fields,
    entitySlug,
    tenantId,
    organizationId,
    omUrl,
    omApiKey,
  } = input;

  const payload = {
    id: omId,
    ...fields,
    tenantId,
    organizationId,
  };

  const res = await fetch(`${omUrl}/api/records`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${omApiKey}`,
    },
    body: JSON.stringify({ entityId: entitySlug, ...payload }),
  });

  if (res.ok) return { ok: true, omId };

  if (res.status === 409) return { ok: true, omId };

  const errorText = await res.text().catch(() => String(res.status));

  const isValidationError = res.status === 400 || res.status === 422;
  if (isValidationError) {
    return {
      ok: false,
      omId,
      needsAttention: true,
      attentionReason: `Błąd walidacji: ${errorText}`,
    };
  }

  return { ok: false, omId, error: `HTTP ${res.status}: ${errorText}` };
}
