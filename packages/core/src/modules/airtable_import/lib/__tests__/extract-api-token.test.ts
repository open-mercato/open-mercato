import { extractApiKeyFromRequest } from "../extract-api-token";

function makeRequest(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/test", { headers });
}

describe("extractApiKeyFromRequest", () => {
  it("extracts token from Authorization Bearer header", () => {
    const req = makeRequest({ authorization: "Bearer my-token-123" });
    expect(extractApiKeyFromRequest(req)).toBe("my-token-123");
  });

  it("extracts token from auth_token cookie", () => {
    const req = makeRequest({ cookie: "auth_token=cookie-token-abc" });
    expect(extractApiKeyFromRequest(req)).toBe("cookie-token-abc");
  });

  it("prefers Authorization header over cookie when both present", () => {
    const req = makeRequest({
      authorization: "Bearer header-token",
      cookie: "auth_token=cookie-token",
    });
    expect(extractApiKeyFromRequest(req)).toBe("header-token");
  });

  it("extracts token from auth_token cookie when other cookies present", () => {
    const req = makeRequest({
      cookie: "session=abc; auth_token=my-token; theme=dark",
    });
    expect(extractApiKeyFromRequest(req)).toBe("my-token");
  });

  it("returns null when no token is present", () => {
    const req = makeRequest({});
    expect(extractApiKeyFromRequest(req)).toBeNull();
  });

  it("returns null for non-Bearer authorization header", () => {
    const req = makeRequest({ authorization: "Basic dXNlcjpwYXNz" });
    expect(extractApiKeyFromRequest(req)).toBeNull();
  });

  it("URL-decodes percent-encoded cookie value", () => {
    const req = makeRequest({ cookie: "auth_token=token%2Fwith%2Fslashes" });
    expect(extractApiKeyFromRequest(req)).toBe("token/with/slashes");
  });
});
