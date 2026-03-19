import { expect, type APIRequestContext } from "@playwright/test";
import { apiRequest } from "@open-mercato/core/modules/core/__integration__/helpers/api";

function readStringId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const id = record.id;
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : null;
}

export async function createResourceFixture(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(
    request,
    "POST",
    "/api/resources/resources",
    {
      token,
      data: { name },
    },
  );
  expect(
    response.ok(),
    `Resource fixture should be created (status ${response.status()})`,
  ).toBeTruthy();
  const payload = await response.json();
  const resourceId = readStringId(payload);
  expect(
    resourceId,
    "Resource id should be returned by create response",
  ).toBeTruthy();
  return resourceId as string;
}

export async function deleteResourceIfExists(
  request: APIRequestContext,
  token: string | null,
  resourceId: string | null,
): Promise<void> {
  if (!token || !resourceId) return;
  await apiRequest(
    request,
    "DELETE",
    `/api/resources/resources?id=${encodeURIComponent(resourceId)}`,
    { token },
  ).catch(() => {});
}
