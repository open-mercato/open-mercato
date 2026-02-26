export interface ImportRecordInput {
  omId: string;
  airtableId: string;
  fields: Record<string, unknown>;
  tenantId: string;
  organizationId: string;
  omUrl: string;
  omApiKey: string;
}

export interface ImportRecordResult {
  ok: boolean;
  omId: string;
  error?: string;
  needsAttention?: boolean;
  attentionReason?: string;
}

export type ModuleImporter = (
  input: ImportRecordInput,
) => Promise<ImportRecordResult>;

export async function postToOmApi(
  endpoint: string,
  payload: Record<string, unknown>,
  omUrl: string,
  omApiKey: string,
): Promise<ImportRecordResult & { responseBody?: unknown }> {
  const res = await fetch(`${omUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${omApiKey}`,
    },
    body: JSON.stringify(payload),
  });
  const omId = ((payload.id as string | undefined) ?? "") as string;
  if (res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: true, omId, responseBody: body };
  }
  if (res.status === 409) return { ok: true, omId };
  const text = await res.text().catch(() => String(res.status));
  if (res.status === 400 || res.status === 422) {
    return {
      ok: false,
      omId,
      needsAttention: true,
      attentionReason: `Błąd walidacji: ${text}`,
    };
  }
  return {
    ok: false,
    omId,
    error: `HTTP ${res.status}: ${text}`,
  };
}
