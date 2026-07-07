import { expect, type APIRequestContext } from "@playwright/test";
import { apiRequest } from "@open-mercato/core/helpers/integration/api";

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

export async function createResourceTypeFixture(
  request: APIRequestContext,
  token: string,
  input: { name: string; description?: string; appearanceIcon?: string; appearanceColor?: string },
): Promise<string> {
  const response = await apiRequest(request, "POST", "/api/resources/resource-types", {
    token,
    data: input,
  });
  expect(
    response.status(),
    `Resource type fixture should be created (status ${response.status()})`,
  ).toBe(201);
  const typeId = readStringId(await response.json());
  expect(typeId, "Resource type id should be returned by create response").toBeTruthy();
  return typeId as string;
}

export async function deleteResourceTypeIfExists(
  request: APIRequestContext,
  token: string | null,
  typeId: string | null,
): Promise<void> {
  if (!token || !typeId) return;
  await apiRequest(
    request,
    "DELETE",
    `/api/resources/resource-types?id=${encodeURIComponent(typeId)}`,
    { token },
  ).catch(() => {});
}

export async function createResourceTagFixture(
  request: APIRequestContext,
  token: string,
  input: { label: string; slug?: string; color?: string; description?: string },
): Promise<string> {
  const response = await apiRequest(request, "POST", "/api/resources/tags", {
    token,
    data: input,
  });
  expect(
    response.status(),
    `Resource tag fixture should be created (status ${response.status()})`,
  ).toBe(201);
  const tagId = readStringId(await response.json());
  expect(tagId, "Resource tag id should be returned by create response").toBeTruthy();
  return tagId as string;
}

export async function deleteResourceTagIfExists(
  request: APIRequestContext,
  token: string | null,
  tagId: string | null,
): Promise<void> {
  if (!token || !tagId) return;
  await apiRequest(
    request,
    "DELETE",
    `/api/resources/tags?id=${encodeURIComponent(tagId)}`,
    { token },
  ).catch(() => {});
}
