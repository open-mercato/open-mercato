import type { ImportRecordInput } from "../types";
import { importPerson, importCompany, importDeal } from "../customers";

const mockFetch = jest.fn();

beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "",
  });
});

afterEach(() => jest.resetAllMocks());

function makePersonInput(
  fields: Record<string, unknown>,
  overrides?: Partial<ImportRecordInput>,
): ImportRecordInput {
  return {
    omId: "uuid-1",
    airtableId: "rec123",
    fields,
    tenantId: "tenant-1",
    organizationId: "org-1",
    omUrl: "http://localhost:3000",
    omApiKey: "api-key-test",
    ...overrides,
  };
}

function makeCompanyInput(
  fields: Record<string, unknown>,
  overrides?: Partial<ImportRecordInput>,
): ImportRecordInput {
  return makePersonInput(fields, overrides);
}

function makeDealInput(
  fields: Record<string, unknown>,
  overrides?: Partial<ImportRecordInput>,
): ImportRecordInput {
  return makePersonInput(fields, overrides);
}

function parsedBody(): Record<string, unknown> {
  const callArgs = mockFetch.mock.calls[0];
  return JSON.parse(callArgs[1].body);
}

// ─── importPerson — pole name jako full name ───────────────────────────────

describe("importPerson — full name field", () => {
  it('splits "Jan Kowalski" into firstName + lastName', async () => {
    await importPerson(makePersonInput({ name: "Jan Kowalski" }));
    const body = parsedBody();
    expect(body.firstName).toBe("Jan");
    expect(body.lastName).toBe("Kowalski");
  });

  it('splits "Jan Maria Kowalski" keeping middle name in firstName', async () => {
    await importPerson(makePersonInput({ name: "Jan Maria Kowalski" }));
    const body = parsedBody();
    expect(body.firstName).toBe("Jan Maria");
    expect(body.lastName).toBe("Kowalski");
  });

  it("handles single-word name with no lastName", async () => {
    await importPerson(makePersonInput({ name: "Kowalski" }));
    const body = parsedBody();
    expect(body.firstName).toBe("Kowalski");
    expect(body.lastName).toBeUndefined();
  });

  it('maps Polish key "imie_i_nazwisko" as full name', async () => {
    await importPerson(makePersonInput({ imie_i_nazwisko: "Anna Nowak" }));
    const body = parsedBody();
    expect(body.firstName).toBe("Anna");
    expect(body.lastName).toBe("Nowak");
  });

  it("trims surrounding whitespace before splitting", async () => {
    await importPerson(makePersonInput({ name: "  Jan  Kowalski  " }));
    const body = parsedBody();
    expect(body.firstName).toBe("Jan");
    expect(body.lastName).toBe("Kowalski");
  });
});

// ─── importPerson — osobne pola firstName/lastName ────────────────────────

describe("importPerson — separate firstName/lastName fields", () => {
  it('maps "first_name" and "last_name" to firstName/lastName', async () => {
    await importPerson(
      makePersonInput({ first_name: "Jan", last_name: "Kowalski" }),
    );
    const body = parsedBody();
    expect(body.firstName).toBe("Jan");
    expect(body.lastName).toBe("Kowalski");
  });

  it('maps Polish aliases "imie" and "nazwisko" to firstName/lastName', async () => {
    await importPerson(makePersonInput({ imie: "Anna", nazwisko: "Nowak" }));
    const body = parsedBody();
    expect(body.firstName).toBe("Anna");
    expect(body.lastName).toBe("Nowak");
  });

  it('PEOPLE_FIELD_MAP always overwrites — "imie" applied after "name" full-name split', async () => {
    // Object.entries preserves insertion order: "name" is processed first (FULL_NAME_KEY → firstName='Jan').
    // Then "imie" is looked up in PEOPLE_FIELD_MAP → maps to 'firstName' and unconditionally overwrites.
    // The guard (!mapped.firstName && !mapped.lastName) only protects FULL_NAME_KEY processing,
    // not the subsequent PEOPLE_FIELD_MAP assignments.
    await importPerson(
      makePersonInput({ name: "Jan Kowalski", imie: "Zignorowane" }),
    );
    const body = parsedBody();
    // "imie" overwrites firstName — this is the actual behaviour
    expect(body.firstName).toBe("Zignorowane");
    expect(body.lastName).toBe("Kowalski");
  });
});

// ─── importPerson — displayName fallback ──────────────────────────────────

describe("importPerson — displayName fallback", () => {
  it("uses airtableId as firstName when no name fields provided", async () => {
    await importPerson(makePersonInput({}));
    const body = parsedBody();
    expect(body.firstName).toBe("rec123");
  });

  it("builds displayName from firstName only when lastName is absent", async () => {
    await importPerson(makePersonInput({ first_name: "Jan" }));
    const body = parsedBody();
    expect(body.displayName).toBe("Jan");
  });

  it('builds displayName as "firstName lastName" when both present', async () => {
    await importPerson(makePersonInput({ name: "Jan Kowalski" }));
    const body = parsedBody();
    expect(body.displayName).toBe("Jan Kowalski");
  });
});

// ─── importPerson — field mapping ─────────────────────────────────────────

describe("importPerson — field mapping", () => {
  it("passes unknown fields through under their original key", async () => {
    await importPerson(makePersonInput({ custom_field: "custom_value" }));
    const body = parsedBody();
    expect(body.custom_field).toBe("custom_value");
  });

  it('maps "email" to "primaryEmail"', async () => {
    await importPerson(makePersonInput({ email: "jan@example.com" }));
    const body = parsedBody();
    expect(body.primaryEmail).toBe("jan@example.com");
    expect(body.email).toBeUndefined();
  });
});

// ─── importPerson — HTTP response handling ────────────────────────────────

describe("importPerson — HTTP response handling", () => {
  it("returns ok: true on HTTP 200", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    const result = await importPerson(
      makePersonInput({ name: "Jan Kowalski" }),
    );
    expect(result.ok).toBe(true);
    expect(result.omId).toBe("uuid-1");
  });

  it("returns ok: true on HTTP 409 (idempotent conflict)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: async () => "Conflict",
    });
    const result = await importPerson(
      makePersonInput({ name: "Jan Kowalski" }),
    );
    expect(result.ok).toBe(true);
    expect(result.omId).toBe("uuid-1");
  });

  it("returns ok: false with needsAttention on HTTP 400", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "lastName is required",
    });
    const result = await importPerson(
      makePersonInput({ name: "Jan Kowalski" }),
    );
    expect(result.ok).toBe(false);
    expect(result.needsAttention).toBe(true);
    expect(result.attentionReason).toContain("Błąd walidacji");
  });

  it("returns ok: false with error on HTTP 500", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });
    const result = await importPerson(
      makePersonInput({ name: "Jan Kowalski" }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("HTTP 500");
  });
});

// ─── importCompany ────────────────────────────────────────────────────────

describe("importCompany", () => {
  it('maps "name" field to displayName', async () => {
    await importCompany(makeCompanyInput({ name: "Acme Corp" }));
    const body = parsedBody();
    expect(body.displayName).toBe("Acme Corp");
  });

  it('maps Polish "nazwa" field to displayName', async () => {
    await importCompany(makeCompanyInput({ nazwa: "Firma SA" }));
    const body = parsedBody();
    expect(body.displayName).toBe("Firma SA");
  });

  it("falls back to airtableId when no name field provided", async () => {
    await importCompany(makeCompanyInput({}));
    const body = parsedBody();
    expect(body.displayName).toBe("rec123");
  });

  it('maps "email" to primaryEmail, "website" to websiteUrl, "industry" to industry', async () => {
    await importCompany(
      makeCompanyInput({
        email: "contact@acme.com",
        website: "https://acme.com",
        industry: "tech",
      }),
    );
    const body = parsedBody();
    expect(body.primaryEmail).toBe("contact@acme.com");
    expect(body.websiteUrl).toBe("https://acme.com");
    expect(body.industry).toBe("tech");
  });

  it('passes through "revenue" field (even as a string)', async () => {
    await importCompany(makeCompanyInput({ revenue: "invalid" }));
    const body = parsedBody();
    // "revenue" maps to "annualRevenue" — the value is passed as-is without coercion
    expect(body.annualRevenue).toBe("invalid");
  });
});

// ─── importDeal ───────────────────────────────────────────────────────────

describe("importDeal", () => {
  it('maps "title" to title', async () => {
    await importDeal(makeDealInput({ title: "Deal 1" }));
    const body = parsedBody();
    expect(body.title).toBe("Deal 1");
  });

  it('maps Polish "tytul" to title', async () => {
    await importDeal(makeDealInput({ tytul: "Oferta" }));
    const body = parsedBody();
    expect(body.title).toBe("Oferta");
  });

  it("falls back to airtableId when no title provided", async () => {
    await importDeal(makeDealInput({}));
    const body = parsedBody();
    expect(body.title).toBe("rec123");
  });

  it('maps "amount" to valueAmount', async () => {
    await importDeal(makeDealInput({ amount: 5000 }));
    const body = parsedBody();
    expect(body.valueAmount).toBe(5000);
  });

  it('maps Polish "wartosc" to valueAmount', async () => {
    await importDeal(makeDealInput({ wartosc: 3000 }));
    const body = parsedBody();
    expect(body.valueAmount).toBe(3000);
  });
});

// ─── Exact endpoint URLs ──────────────────────────────────────────────────

describe("exact endpoint URLs", () => {
  it("importPerson posts to /api/customers/people", async () => {
    await importPerson(makePersonInput({ name: "Jan" }));
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/customers/people");
  });

  it("importCompany posts to /api/customers/companies", async () => {
    await importCompany(makeCompanyInput({ name: "Acme" }));
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/customers/companies");
  });

  it("importDeal posts to /api/customers/deals", async () => {
    await importDeal(makeDealInput({ title: "Deal" }));
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:3000/api/customers/deals");
  });
});

// ─── Authorization header ─────────────────────────────────────────────────

describe("Authorization header", () => {
  it("sends Bearer token from omApiKey in every request", async () => {
    await importPerson(
      makePersonInput({ name: "Jan" }, { omApiKey: "secret-token-xyz" }),
    );
    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer secret-token-xyz");
  });
});
