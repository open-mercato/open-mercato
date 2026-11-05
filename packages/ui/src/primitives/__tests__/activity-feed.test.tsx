/** @jest-environment jsdom */

import * as React from 'react'
import { render, fireEvent } from '@testing-library/react'

import {
  ActivityFeed,
  ActivityFeedItem,
  ActivityFeedFileChip,
  ActivityFeedComment,
  ActivityFeedStatusChip,
} from '../activity-feed'

describe('ActivityFeed', () => {
  it('renders an <ol> root with the data-slot marker', () => {
    const { container } = render(
      <ActivityFeed>
        <ActivityFeedItem title="Wei Chen uploaded report" />
      </ActivityFeed>,
    )
    const root = container.querySelector('[data-slot="activity-feed"]') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.tagName).toBe('OL')
  })

  it('renders item title + timestamp as a muted suffix (no separator glyph)', () => {
    const { container } = render(
      <ActivityFeed>
        <ActivityFeedItem title="Wei Chen uploaded report" timestamp="4 min ago" />
      </ActivityFeed>,
    )
    const title = container.querySelector('[data-slot="activity-feed-item-title"]') as HTMLElement
    expect(title).not.toBeNull()
    expect(title.textContent).toContain('Wei Chen uploaded report')
    const ts = container.querySelector('[data-slot="activity-feed-item-timestamp"]') as HTMLElement
    expect(ts).not.toBeNull()
    expect(ts.textContent).toBe('4 min ago')
    // No middle-dot separator anywhere in the title row — visual gap
    // comes from the wrapper's `gap-x-2` only.
    expect(title.textContent).not.toContain('·')
    expect(ts.className).toContain('text-muted-foreground')
  })

  it('omits the timestamp slot when no timestamp is provided', () => {
    const { container } = render(
      <ActivityFeed>
        <ActivityFeedItem title="No time entry" />
      </ActivityFeed>,
    )
    expect(container.querySelector('[data-slot="activity-feed-item-timestamp"]')).toBeNull()
  })

  it('renders avatar + actions slots when provided', () => {
    const { container } = render(
      <ActivityFeed>
        <ActivityFeedItem
          avatar={<span data-testid="avatar">A</span>}
          title="Wei Chen uploaded report"
          actions={<button data-testid="kebab">⋯</button>}
        />
      </ActivityFeed>,
    )
    expect(container.querySelector('[data-slot="activity-feed-item-avatar"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="avatar"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="activity-feed-item-actions"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="kebab"]')).not.toBeNull()
  })

  it('renders an indented content block when children are provided', () => {
    const { container } = render(
      <ActivityFeed>
        <ActivityFeedItem title="Wei Chen uploaded report">
          <ActivityFeedFileChip name="apex-report.pdf" size="4mb" />
        </ActivityFeedItem>
      </ActivityFeed>,
    )
    const content = container.querySelector('[data-slot="activity-feed-item-content"]') as HTMLElement
    expect(content).not.toBeNull()
    expect(content.querySelector('[data-slot="activity-feed-file-chip"]')).not.toBeNull()
  })

  it('omits the content block when no children are provided', () => {
    const { container } = render(
      <ActivityFeed>
        <ActivityFeedItem title="Wei Chen uploaded report" />
      </ActivityFeed>,
    )
    expect(container.querySelector('[data-slot="activity-feed-item-content"]')).toBeNull()
  })

  it('renders the FileChip download button only when `onDownload` is provided', () => {
    const onDownload = jest.fn()
    const { container, rerender } = render(
      <ActivityFeed>
        <ActivityFeedItem title="t">
          <ActivityFeedFileChip name="a.pdf" size="4mb" />
        </ActivityFeedItem>
      </ActivityFeed>,
    )
    expect(container.querySelector('[data-slot="activity-feed-file-chip-download"]')).toBeNull()

    rerender(
      <ActivityFeed>
        <ActivityFeedItem title="t">
          <ActivityFeedFileChip name="a.pdf" size="4mb" onDownload={onDownload} />
        </ActivityFeedItem>
      </ActivityFeed>,
    )
    const download = container.querySelector(
      '[data-slot="activity-feed-file-chip-download"]',
    ) as HTMLButtonElement
    expect(download).not.toBeNull()
    fireEvent.click(download)
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it('renders the Comment Reply button only when `onReply` is provided + fires the callback', () => {
    const onReply = jest.fn()
    const { container, rerender } = render(
      <ActivityFeed>
        <ActivityFeedItem title="t">
          <ActivityFeedComment>Hello?</ActivityFeedComment>
        </ActivityFeedItem>
      </ActivityFeed>,
    )
    expect(container.querySelector('[data-slot="activity-feed-comment-reply"]')).toBeNull()

    rerender(
      <ActivityFeed>
        <ActivityFeedItem title="t">
          <ActivityFeedComment onReply={onReply}>Hello?</ActivityFeedComment>
        </ActivityFeedItem>
      </ActivityFeed>,
    )
    const reply = container.querySelector('[data-slot="activity-feed-comment-reply"]') as HTMLButtonElement
    expect(reply).not.toBeNull()
    expect(reply.textContent).toBe('Reply')
    fireEvent.click(reply)
    expect(onReply).toHaveBeenCalledTimes(1)
  })

  it('renders the StatusChip with the correct data-status + tone class per status', () => {
    const cases: Array<{
      status: 'success' | 'warning' | 'info' | 'error' | 'neutral'
      tone: string
    }> = [
      { status: 'success', tone: 'text-status-success-icon' },
      { status: 'warning', tone: 'text-status-warning-icon' },
      { status: 'info', tone: 'text-status-info-icon' },
      { status: 'error', tone: 'text-status-error-icon' },
      { status: 'neutral', tone: 'text-muted-foreground' },
    ]
    for (const { status, tone } of cases) {
      const { container, unmount } = render(
        <ActivityFeedStatusChip status={status}>12 tasks completed</ActivityFeedStatusChip>,
      )
      const chip = container.querySelector('[data-slot="activity-feed-status-chip"]') as HTMLElement
      expect(chip).not.toBeNull()
      expect(chip.getAttribute('data-status')).toBe(status)
      const iconWrap = chip.querySelector(
        '[data-slot="activity-feed-status-chip-icon"]',
      ) as HTMLElement
      expect(iconWrap.className).toContain(tone)
      expect(chip.textContent).toContain('12 tasks completed')
      unmount()
    }
  })

  it('defaults the StatusChip status to "neutral" when no status prop is passed', () => {
    const { container } = render(
      <ActivityFeedStatusChip>Idle</ActivityFeedStatusChip>,
    )
    const chip = container.querySelector('[data-slot="activity-feed-status-chip"]') as HTMLElement
    expect(chip.getAttribute('data-status')).toBe('neutral')
  })

  it('forwards className on each compound slot', () => {
    const { container } = render(
      <ActivityFeed className="root-custom">
        <ActivityFeedItem className="item-custom" title="t">
          <ActivityFeedFileChip className="file-custom" name="a.pdf" />
          <ActivityFeedComment className="comment-custom">c</ActivityFeedComment>
          <ActivityFeedStatusChip className="status-custom">s</ActivityFeedStatusChip>
        </ActivityFeedItem>
      </ActivityFeed>,
    )
    expect(container.querySelector('[data-slot="activity-feed"]')!.className).toContain('root-custom')
    expect(container.querySelector('[data-slot="activity-feed-item"]')!.className).toContain('item-custom')
    expect(container.querySelector('[data-slot="activity-feed-file-chip"]')!.className).toContain('file-custom')
    expect(container.querySelector('[data-slot="activity-feed-comment"]')!.className).toContain('comment-custom')
    expect(container.querySelector('[data-slot="activity-feed-status-chip"]')!.className).toContain('status-custom')
  })

  it('renders ReactNode title (with inline status chip mixed in) — Figma-style inline sentence', () => {
    const { container } = render(
      <ActivityFeed>
        <ActivityFeedItem
          title={
            <>
              Laura Perez{' '}
              <span className="text-muted-foreground font-normal">requested changes</span>{' '}
              <ActivityFeedStatusChip status="error">Needs revision</ActivityFeedStatusChip>
            </>
          }
          timestamp="6 days ago"
        />
      </ActivityFeed>,
    )
    const title = container.querySelector('[data-slot="activity-feed-item-title"]') as HTMLElement
    expect(title.textContent).toContain('Laura Perez')
    expect(title.textContent).toContain('requested changes')
    // Status chip is nested inside the title (inline pattern).
    expect(title.querySelector('[data-slot="activity-feed-status-chip"]')).not.toBeNull()
    expect(title.querySelector('[data-status="error"]')).not.toBeNull()
  })
})
