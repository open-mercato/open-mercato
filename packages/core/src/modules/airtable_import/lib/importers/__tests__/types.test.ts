import { postToOmApi } from "../types";

describe("postToOmApi", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  const defaultPayload = { id: "uuid-1", name: "Test", tenantId: "tenant-1" };
  const omUrl = "http://localhost:3000";
  const omApiKey = "test-api-key";
  const endpoint = "/api/customers/people";

  function mockResponse(status: number, body?: unknown, text?: string) {
    mockFetch.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body ?? {},
      text: async () => text ?? String(status),
    });
  }

  // -------------------------------------------------------------------------
  // Success (2xx)
  // -------------------------------------------------------------------------

  it("HTTP 200 returns ok: true with omId and responseBody", async () => {
    mockResponse(200, { data: { id: "uuid-1" } });

    const result = await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    expect(result.ok).toBe(true);
    expect(result.omId).toBe("uuid-1");
    expect(result.responseBody).toEqual({ data: { id: "uuid-1" } });
  });

  it("HTTP 201 also returns ok: true because res.ok is true for 201", async () => {
    mockResponse(201, { id: "uuid-1" });

    const result = await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    expect(result.ok).toBe(true);
    expect(result.omId).toBe("uuid-1");
  });

  it("broken JSON body — json() throws — returns responseBody as empty object", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token");
      },
      text: async () => "not json",
    });

    const result = await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    expect(result.ok).toBe(true);
    expect(result.omId).toBe("uuid-1");
    expect(result.responseBody).toEqual({});
  });

  it("body with nested data — responseBody mirrors full API response", async () => {
    const apiBody = {
      id: "uuid-1",
      firstName: "Jan",
      lastName: "Kowalski",
      customFields: { crm: "hot" },
    };
    mockResponse(200, apiBody);

    const result = await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    expect(result.responseBody).toEqual(apiBody);
  });

  // -------------------------------------------------------------------------
  // Conflict (409)
  // -------------------------------------------------------------------------

  it("HTTP 409 returns ok: true — record already exists (idempotent)", async () => {
    mockResponse(409);

    const result = await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    expect(result.ok).toBe(true);
    expect(result.omId).toBe("uuid-1");
  });

  it("HTTP 409 does not read body — responseBody is undefined", async () => {
    mockResponse(409);

    const result = await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    expect(result.responseBody).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Validation errors (400, 422)
  // -------------------------------------------------------------------------

  it("HTTP 400 returns ok: false with needsAttention and attentionReason", async () => {
    mockResponse(400, undefined, "firstName is required");

    const result = await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    expect(result.ok).toBe(false);
    expect(result.omId).toBe("uuid-1");
    expect(result.needsAttention).toBe(true);
    expect(result.attentionReason).toBe(
      "Błąd walidacji: firstName is required",
    );
  });

  it("HTTP 422 returns ok: false with needsAttention", async () => {
    mockResponse(422, undefined, "Unprocessable entity");

    const result = await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    expect(result.ok).toBe(false);
    expect(result.needsAttention).toBe(true);
    expect(result.attentionReason).toBe("Błąd walidacji: Unprocessable entity");
  });

  it("HTTP 400 — text() throws — attentionReason falls back to status code string", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => {
        throw new Error("no json");
      },
      text: async () => {
        throw new Error("read error");
      },
    });

    const result = await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    expect(result.ok).toBe(false);
    expect(result.needsAttention).toBe(true);
    expect(result.attentionReason).toBe("Błąd walidacji: 400");
  });

  it("HTTP 422 — long error message from API — full text preserved in attentionReason", async () => {
    const longMessage =
      "email: must be a valid email address; phone: must start with country code; lastName: cannot exceed 255 characters";
    mockResponse(422, undefined, longMessage);

    const result = await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    expect(result.attentionReason).toBe(`Błąd walidacji: ${longMessage}`);
  });

  // -------------------------------------------------------------------------
  // Hard errors (5xx, and non-400/409/422 4xx)
  // -------------------------------------------------------------------------

  it("HTTP 500 returns ok: false with error field containing status and text", async () => {
    mockResponse(500, undefined, "Internal Server Error");

    const result = await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    expect(result.ok).toBe(false);
    expect(result.omId).toBe("uuid-1");
    expect(result.error).toBe("HTTP 500: Internal Server Error");
    expect(result.needsAttention).toBeUndefined();
  });

  it("HTTP 503 returns ok: false with error field", async () => {
    mockResponse(503, undefined, "Service Unavailable");

    const result = await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("HTTP 503: Service Unavailable");
  });

  it("HTTP 401 returns ok: false with error — not needsAttention", async () => {
    mockResponse(401, undefined, "Unauthorized");

    const result = await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("HTTP 401: Unauthorized");
    expect(result.needsAttention).toBeUndefined();
  });

  it("HTTP 403 returns ok: false with error", async () => {
    mockResponse(403, undefined, "Forbidden");

    const result = await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("HTTP 403: Forbidden");
    expect(result.needsAttention).toBeUndefined();
  });

  it("HTTP 404 returns ok: false with error — not needsAttention", async () => {
    mockResponse(404, undefined, "Not Found");

    const result = await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("HTTP 404: Not Found");
    expect(result.needsAttention).toBeUndefined();
  });

  it("HTTP 500 — text() throws — error falls back to status code only", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("no json");
      },
      text: async () => {
        throw new Error("read error");
      },
    });

    const result = await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("HTTP 500: 500");
  });

  // -------------------------------------------------------------------------
  // URL and headers
  // -------------------------------------------------------------------------

  it("builds the full URL as omUrl + endpoint", async () => {
    mockResponse(200, {});

    await postToOmApi(
      "/api/customers/people",
      defaultPayload,
      "http://example.com",
      omApiKey,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "http://example.com/api/customers/people",
      expect.any(Object),
    );
  });

  it("sends Authorization header with Bearer scheme", async () => {
    mockResponse(200, {});

    await postToOmApi(endpoint, defaultPayload, omUrl, "secret-key-abc");

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer secret-key-abc",
    );
  });

  it("sends Content-Type: application/json header", async () => {
    mockResponse(200, {});

    await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("sends body as JSON.stringify of the payload", async () => {
    const payload = {
      id: "uuid-1",
      firstName: "Anna",
      email: "anna@example.com",
    };
    mockResponse(200, {});

    await postToOmApi(endpoint, payload, omUrl, omApiKey);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(options.body).toBe(JSON.stringify(payload));
  });

  it("uses POST as the HTTP method", async () => {
    mockResponse(200, {});

    await postToOmApi(endpoint, defaultPayload, omUrl, omApiKey);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe("POST");
  });

  // -------------------------------------------------------------------------
  // Edge cases with omId
  // -------------------------------------------------------------------------

  it("omId in result matches payload.id exactly for 2xx", async () => {
    mockResponse(200, {});
    const payload = { id: "uuid-test-42", name: "X" };

    const result = await postToOmApi(endpoint, payload, omUrl, omApiKey);

    expect(result.omId).toBe("uuid-test-42");
  });

  it("omId in result matches payload.id for 409", async () => {
    mockResponse(409);
    const payload = { id: "uuid-conflict", name: "X" };

    const result = await postToOmApi(endpoint, payload, omUrl, omApiKey);

    expect(result.omId).toBe("uuid-conflict");
  });

  it("omId in result matches payload.id for 400 validation error", async () => {
    mockResponse(400, undefined, "bad data");
    const payload = { id: "uuid-bad", name: "X" };

    const result = await postToOmApi(endpoint, payload, omUrl, omApiKey);

    expect(result.omId).toBe("uuid-bad");
  });

  it("omId in result matches payload.id for 500 error", async () => {
    mockResponse(500, undefined, "boom");
    const payload = { id: "uuid-server-error", name: "X" };

    const result = await postToOmApi(endpoint, payload, omUrl, omApiKey);

    expect(result.omId).toBe("uuid-server-error");
  });

  it("payload.id = undefined — omId falls back to empty string without throwing", async () => {
    mockResponse(200, {});
    const payload: Record<string, unknown> = { name: "No ID here" };

    const result = await postToOmApi(endpoint, payload, omUrl, omApiKey);

    expect(result.ok).toBe(true);
    expect(result.omId).toBe("");
  });
});
