import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDoc } from '@docusaurus/plugin-content-docs/client';
import useBaseUrl from '@docusaurus/useBaseUrl';

const DOCS_SOURCE_PREFIX = '@site/docs/';

type LoadStatus = 'loading' | 'ready' | 'error';
type ActionFlash = 'copied' | 'error' | null;

/**
 * A static-site host serving `/raw/<missing-path>` may fall back to `index.html`
 * with a 200 status (single-page-app rewrite) instead of a 404. Guard against
 * treating that fallback page as a valid raw Markdown source.
 */
export function isAcceptableRawSourceResponse(response: { ok: boolean; headers: { get(name: string): string | null } }): boolean {
  const contentType = response.headers.get('content-type') ?? '';
  return response.ok && !contentType.includes('text/html');
}

export default function CopyPageButton(): React.ReactElement {
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading');
  const [actionFlash, setActionFlash] = useState<ActionFlash>(null);
  const [source, setSource] = useState<{ path: string; content: string } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { metadata } = useDoc();
  const sourcePath = metadata.source?.startsWith(DOCS_SOURCE_PREFIX)
    ? metadata.source.slice(DOCS_SOURCE_PREFIX.length)
    : null;
  const rawSourceUrl = useBaseUrl(sourcePath ? `raw/${sourcePath}` : 'raw/');

  const loadSource = useCallback(
    (signal?: AbortSignal) => {
      setLoadStatus('loading');
      setSource(null);

      if (!sourcePath) {
        setLoadStatus('error');
        return;
      }

      void fetch(rawSourceUrl, { signal })
        .then(async (response) => {
          if (!isAcceptableRawSourceResponse(response)) {
            throw new Error('[internal] Unable to load raw documentation source.');
          }
          return response.text();
        })
        .then((content) => {
          setSource({ path: sourcePath, content });
          setLoadStatus('ready');
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setLoadStatus('error');
        });
    },
    [rawSourceUrl, sourcePath],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadSource(controller.signal);

    return () => {
      controller.abort();
      clearTimeout(timeoutRef.current);
    };
  }, [loadSource]);

  function flashAction(next: 'copied' | 'error') {
    setActionFlash(next);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setActionFlash(null), 2000);
  }

  function handleClick() {
    if (loadStatus === 'error') {
      loadSource();
      return;
    }

    if (loadStatus !== 'ready' || !source || source.path !== sourcePath) {
      flashAction('error');
      return;
    }

    void navigator.clipboard.writeText(source.content).then(
      () => flashAction('copied'),
      () => flashAction('error'),
    );
  }

  const label =
    loadStatus === 'error'
      ? 'Failed to load — retry'
      : actionFlash === 'copied'
        ? 'Copied!'
        : actionFlash === 'error'
          ? 'Failed to copy'
          : loadStatus === 'loading'
            ? 'Preparing copy'
            : 'Copy page';

  return (
    <button
      data-copy-page-button
      type="button"
      disabled={loadStatus === 'loading'}
      className={[
        'copy-page-button',
        actionFlash === 'copied' && 'copy-page-button--copied',
        (actionFlash === 'error' || loadStatus === 'error') && 'copy-page-button--error',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
      title={label}
      aria-label="Copy page as Markdown"
    >
      {actionFlash === 'copied' ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M13.5 4.5L6 12L2.5 8.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect
            x="5.5"
            y="5.5"
            width="8"
            height="8"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H3.5C2.67 2 2 2.67 2 3.5V9C2 9.83 2.67 10.5 3.5 10.5H5.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )}
      <span className="copy-page-button__label" role="status" aria-live="polite">
        {label}
      </span>
    </button>
  );
}
