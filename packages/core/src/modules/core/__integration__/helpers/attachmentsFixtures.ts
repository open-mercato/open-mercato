import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';
import { expectId, readJsonSafe } from './generalFixtures';

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000';

type AttachmentAssignment = {
  type: string;
  id: string;
  href?: string | null;
  label?: string | null;
};

type MultipartFieldValue =
  | string
  | number
  | boolean
  | {
      name: string;
      mimeType: string;
      buffer: Buffer;
    };

function resolveApiUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

export async function uploadAttachmentFixture(
  request: APIRequestContext,
  token: string,
  input: {
    entityId: string;
    recordId: string;
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    partitionCode?: string;
    tags?: string[];
    assignments?: AttachmentAssignment[];
  },
): Promise<{
  id: string;
  partitionCode: string;
  fileName: string;
  tags: string[];
  assignments: AttachmentAssignment[];
}> {
  const multipart: Record<string, MultipartFieldValue> = {
    entityId: input.entityId,
    recordId: input.recordId,
    file: {
      name: input.fileName,
      mimeType: input.mimeType,
      buffer: input.buffer,
    },
  };
  if (input.partitionCode) multipart.partitionCode = input.partitionCode;
  if (input.tags) multipart.tags = JSON.stringify(input.tags);
  if (input.assignments) multipart.assignments = JSON.stringify(input.assignments);

  const response = await request.fetch(resolveApiUrl('/api/attachments'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    multipart,
  });
  const body = await readJsonSafe<{
    ok?: boolean;
    item?: {
      id?: string;
      partitionCode?: string;
      fileName?: string;
      tags?: string[];
      assignments?: AttachmentAssignment[];
    };
  }>(response);
  expect(response.status(), 'POST /api/attachments should return 200').toBe(200);
  return {
    id: expectId(body?.item?.id, 'Attachment upload response should include item.id'),
    partitionCode: String(body?.item?.partitionCode ?? ''),
    fileName: String(body?.item?.fileName ?? ''),
    tags: body?.item?.tags ?? [],
    assignments: body?.item?.assignments ?? [],
  };
}

export async function deleteAttachmentIfExists(
  request: APIRequestContext,
  token: string | null,
  attachmentId: string | null,
): Promise<void> {
  if (!token || !attachmentId) return;
  await apiRequest(
    request,
    'DELETE',
    `/api/attachments?id=${encodeURIComponent(attachmentId)}`,
    { token },
  ).catch(() => undefined);
}

export async function deleteAttachmentPartitionIfExists(
  request: APIRequestContext,
  token: string | null,
  partitionId: string | null,
): Promise<void> {
  if (!token || !partitionId) return;
  await apiRequest(
    request,
    'DELETE',
    `/api/attachments/partitions?id=${encodeURIComponent(partitionId)}`,
    { token },
  ).catch(() => undefined);
}
