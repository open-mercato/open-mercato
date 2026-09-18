const exposedId = '123e4567-e89b-12d3-a456-426614174000'

import {
  readUserLabels,
  readWithoutAccess,
} from '../backend/documents/[id]/commentTypes'
import { normalizeVersion } from '../backend/documents/[id]/versionHistoryModel'

describe('document history display labels', () => {
  it('replaces unsafe comment identity labels and drops unsafe secondary labels', () => {
    expect(readUserLabels({
      userLabels: {
        [exposedId]: {
          label: `User ${exposedId}`,
          secondary: exposedId,
        },
      },
    }, 'Unknown user')).toEqual({
      [exposedId]: { label: 'Unknown user', secondary: null },
    })
  })

  it('never turns access-check IDs into display labels', () => {
    expect(readWithoutAccess({
      withoutAccessUsers: [{
        userId: exposedId,
        label: exposedId,
        secondary: `Account ${exposedId}`,
      }],
    })).toEqual([{
      userId: exposedId,
      label: null,
      secondary: null,
    }])
  })

  it('keeps version IDs internal when server-provided history labels are unsafe', () => {
    expect(normalizeVersion({
      id: exposedId,
      label: `Version ${exposedId}`,
      createdByLabel: exposedId,
      createdAt: '2026-07-10T12:00:00.000Z',
    }, 'Unknown user')).toEqual({
      id: exposedId,
      label: null,
      creatorLabel: 'Unknown user',
      createdAt: '2026-07-10T12:00:00.000Z',
    })
  })
})
