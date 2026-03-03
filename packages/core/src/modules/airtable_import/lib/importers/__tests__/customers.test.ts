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
  it.each<[Record<string, unknown>, string, string | undefined]>([
    [{ name: "Jan Kowalski" }, "Jan", "Kowalski"],
    [{ name: "Jan Maria Kowalski" }, "Jan Maria", "Kowalski"],
    [{ name: "Kowalski" }, "Kowalski", undefined],
    [{ imie_i_nazwisko: "Anna Nowak" }, "Anna", "Nowak"],
    [{ name: "  Jan  Kowalski  " }, "Jan", "Kowalski"],
  ])(
    "splits full name %j → firstName=%s lastName=%s",
    async (fields, firstName, lastName) => {
      await importPerson(makePersonInput(fields));
      const body = parsedBody();
      expect(body.firstName).toBe(firstName);
      if (lastName !== undefined) {
        expect(body.lastName).toBe(lastName);
      } else {
        expect(body.lastName).toBeUndefined();
      }
    },
  );
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
  it.each<
    [
      number,
      boolean,
      string | undefined,
      boolean | undefined,
      string | undefined,
      string | undefined,
    ]
  >([
    [200, true, "uuid-1", undefined, undefined, undefined],
    [409, true, "uuid-1", undefined, undefined, undefined],
    [400, false, undefined, true, "Błąd walidacji", undefined],
    [500, false, undefined, undefined, undefined, "HTTP 500"],
  ])(
    "HTTP %d → ok=%s",
    async (
      status,
      expectedOk,
      expectedOmId,
      expectedNeedsAttention,
      expectedAttentionReason,
      expectedError,
    ) => {
      mockFetch.mockResolvedValueOnce({
        ok: status < 400,
        status,
        json: async () => ({}),
        text: async () => `HTTP ${status}: error`,
      });
      const result = await importPerson(
        makePersonInput({ name: "Jan Kowalski" }),
      );
      expect(result.ok).toBe(expectedOk);
      if (expectedOmId !== undefined) {
        expect(result.omId).toBe(expectedOmId);
      }
      if (expectedNeedsAttention !== undefined) {
        expect(result.needsAttention).toBe(expectedNeedsAttention);
      }
      if (expectedAttentionReason !== undefined) {
        expect(result.attentionReason).toContain(expectedAttentionReason);
      }
      if (expectedError !== undefined) {
        expect(result.error).toContain(expectedError);
      }
    },
  );
});

// ─── importCompany ────────────────────────────────────────────────────────

describe("importCompany", () => {
  it.each<[Record<string, unknown>, string]>([
    [{ name: "Acme Corp" }, "Acme Corp"],
    [{ nazwa: "Firma SA" }, "Firma SA"],
    [{}, "rec123"],
  ])(
    "maps company name field %j → displayName=%s",
    async (fields, expectedDisplayName) => {
      await importCompany(makeCompanyInput(fields));
      const body = parsedBody();
      expect(body.displayName).toBe(expectedDisplayName);
    },
  );

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
  describe("importDeal — title mapping", () => {
    it.each<[Record<string, unknown>, string]>([
      [{ title: "Deal 1" }, "Deal 1"],
      [{ tytul: "Oferta" }, "Oferta"],
      [{}, "rec123"],
    ])("maps %j → title=%s", async (fields, expectedTitle) => {
      await importDeal(makeDealInput(fields));
      const body = parsedBody();
      expect(body.title).toBe(expectedTitle);
    });
  });

  describe("importDeal — amount mapping", () => {
    it.each<[Record<string, unknown>, number]>([
      [{ amount: 5000 }, 5000],
      [{ wartosc: 3000 }, 3000],
    ])("maps %j → valueAmount=%d", async (fields, expectedAmount) => {
      await importDeal(makeDealInput(fields));
      const body = parsedBody();
      expect(body.valueAmount).toBe(expectedAmount);
    });
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
