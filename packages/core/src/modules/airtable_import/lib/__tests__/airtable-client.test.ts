import { AirtableClient } from "../airtable-client";

describe("AirtableClient", () => {
  const mockFetch = jest.fn();
  let client: AirtableClient;

  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
    client = new AirtableClient("pat_test_token", "appTestBase123");
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("fetches base schema with correct auth header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tables: [
          { id: "tbl1", name: "Klienci", fields: [], primaryFieldId: "fld1" },
        ],
      }),
    });

    const schema = await client.fetchSchema();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.airtable.com/v0/meta/bases/appTestBase123/tables",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer pat_test_token",
        }),
      }),
    );
    expect(schema.tables).toHaveLength(1);
    expect(schema.tables[0].name).toBe("Klienci");
  });

  it("fetches sample records for a table", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        records: [
          {
            id: "rec1",
            fields: { Email: "jan@firma.pl", Imie: "Jan" },
            createdTime: "2023-01-01T00:00:00Z",
          },
        ],
      }),
    });

    const records = await client.fetchSampleRecords("tbl1", 5);

    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("rec1");
    expect(records[0].fields["Email"]).toBe("jan@firma.pl");
  });

  it("fetches all record IDs for plan generation", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [{ id: "rec1" }, { id: "rec2" }],
          offset: "page2token",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [{ id: "rec3" }],
        }),
      });

    const ids = await client.fetchAllRecordIds("tbl1");

    expect(ids).toEqual(["rec1", "rec2", "rec3"]);
  });

  it("throws with clear message on 401", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(client.fetchSchema()).rejects.toThrow(
      "Token Airtable jest nieprawidłowy lub wygasł",
    );
  });

  it("fetches collaborators", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        collaborators: [
          {
            id: "usr1",
            email: "jan@firma.pl",
            name: "Jan",
            permissionLevel: "owner",
          },
        ],
      }),
    });

    const collabs = await client.fetchCollaborators();
    expect(collabs).toHaveLength(1);
    expect(collabs[0].permissionLevel).toBe("owner");
  });
});
