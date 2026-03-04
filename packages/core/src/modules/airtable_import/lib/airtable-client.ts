import type {
  AirtableTableSchema,
  AirtableCollaborator,
} from "../data/entities";

const BASE_URL = "https://api.airtable.com";

interface FetchedRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime?: string;
}

export class AirtableClient {
  constructor(
    private readonly token: string,
    private readonly baseId: string,
  ) {}

  private async request<T>(
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401)
        throw new Error("Airtable token is invalid or expired");
      if (res.status === 403)
        throw new Error("Access denied to this Airtable base");
      if (res.status === 404)
        throw new Error("Airtable base not found");
      throw new Error(`Airtable API error (${res.status}): ${text}`);
    }

    return res.json() as T;
  }

  async fetchSchema(): Promise<{ tables: AirtableTableSchema[] }> {
    return this.request<{ tables: AirtableTableSchema[] }>(
      `/v0/meta/bases/${this.baseId}/tables`,
    );
  }

  async fetchSampleRecords(
    tableId: string,
    maxRecords = 5,
  ): Promise<FetchedRecord[]> {
    const data = await this.request<{ records: FetchedRecord[] }>(
      `/v0/${this.baseId}/${tableId}`,
      { maxRecords: String(maxRecords), pageSize: String(maxRecords) },
    );
    return data.records;
  }

  async fetchAllRecordIds(tableId: string): Promise<string[]> {
    const ids: string[] = [];
    let offset: string | undefined;

    do {
      const reqParams: Record<string, string> = { pageSize: "100" };
      if (offset) reqParams.offset = offset;

      const data = await this.request<{
        records: { id: string }[];
        offset?: string;
      }>(`/v0/${this.baseId}/${tableId}`, reqParams);

      ids.push(...data.records.map((r) => r.id));
      offset = data.offset;
    } while (offset);

    return ids;
  }

  async fetchRecordsByIds(
    tableId: string,
    recordIds: string[],
  ): Promise<FetchedRecord[]> {
    const results: FetchedRecord[] = [];
    for (const recordId of recordIds) {
      const data = await this.request<FetchedRecord>(
        `/v0/${this.baseId}/${tableId}/${recordId}`,
      );
      results.push(data);
    }
    return results;
  }

  async fetchAllRecords(tableId: string): Promise<FetchedRecord[]> {
    const records: FetchedRecord[] = [];
    let offset: string | undefined;

    do {
      const params: Record<string, string> = { pageSize: "100" };
      if (offset) params.offset = offset;

      const data = await this.request<{
        records: FetchedRecord[];
        offset?: string;
      }>(`/v0/${this.baseId}/${tableId}`, params);

      records.push(...data.records);
      offset = data.offset;
    } while (offset);

    return records;
  }

  async fetchCollaborators(): Promise<AirtableCollaborator[]> {
    const data = await this.request<{ collaborators: AirtableCollaborator[] }>(
      `/v0/meta/bases/${this.baseId}/collaborators`,
    );
    return data.collaborators ?? [];
  }

  async fetchBaseInfo(): Promise<{ name: string } | null> {
    const data = await this.request<{
      bases: Array<{ id: string; name: string }>;
    }>("/v0/meta/bases");
    return data.bases.find((b) => b.id === this.baseId) ?? null;
  }
}
