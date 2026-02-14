import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ObjectPreviewData } from '@open-mercato/shared/modules/messages/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffLeaveRequest } from '../data/entities'

type PreviewContext = {
  tenantId: string
  organizationId?: string | null
}

function mapStatus(status: string): { label: string; color: string } {
  if (status === 'approved') {
    return { label: 'Approved', color: 'green' }
  }
  if (status === 'rejected') {
    return { label: 'Rejected', color: 'red' }
  }
  return { label: 'Pending', color: 'amber' }
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export async function loadLeaveRequestPreview(
  entityId: string,
  ctx: PreviewContext,
): Promise<ObjectPreviewData> {
  if (!ctx.organizationId) {
    return {
      title: 'Leave request',
      subtitle: entityId,
    }
  }

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const request = await findOneWithDecryption(
    em,
    StaffLeaveRequest,
    {
      id: entityId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )

  if (!request) {
    return {
      title: 'Leave request',
      subtitle: entityId,
      status: 'Not found',
      statusColor: 'gray',
    }
  }

  const status = mapStatus(request.status)
  const memberName = typeof request.member?.displayName === 'string' ? request.member.displayName : null
  const subtitle = memberName
    ? `${memberName} - ${formatDate(request.startDate)} to ${formatDate(request.endDate)}`
    : `${formatDate(request.startDate)} to ${formatDate(request.endDate)}`

  return {
    title: 'Leave request',
    subtitle,
    status: status.label,
    statusColor: status.color,
    metadata: {
      'Start date': formatDate(request.startDate),
      'End date': formatDate(request.endDate),
      Timezone: request.timezone,
    },
  }
}
