import React, { useEffect, useRef, useState } from 'react';
import { useDoc } from '@docusaurus/plugin-content-docs/client';

export default function CopyPageButton({ wide }: { wide?: boolean } = {}): React.ReactElement {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [source, setSource] = useState<string | null | undefined>(undefined);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { metadata } = useDoc();
  const sourcePath = metadata.source?.replace('@site/docs/', '') || '';

  useEffect(() => {
    if (!sourcePath) {
      setSource(null);
      return;
    }

    let cancelled = false;

    void fetch(`/raw/${sourcePath}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('[internal] Unable to load raw documentation source.');
        return response.text();
      })
      .then((content) => {
        if (!cancelled) setSource(content);
      })
      .catch(() => {
        if (!cancelled) flashState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [sourcePath]);

  function handleCopy() {
    if (typeof source !== 'string') {
      flashState('error');
      return;
    }

    void navigator.clipboard.writeText(source).then(
      () => flashState('copied'),
      () => flashState('error'),
    );
  }

  function flashState(next: 'copied' | 'error') {
    setState(next);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setState('idle'), 2000);
  }

  const label =
    state === 'copied'
      ? 'Copied!'
      : state === 'error'
        ? 'Failed to copy'
        : source === undefined
          ? 'Preparing copy'
          : 'Copy page';

  return (
    <button
      data-copy-page-button
      type="button"
      disabled={source === undefined}
      className={[
        'copy-page-button',
        state === 'copied' && 'copy-page-button--copied',
        state === 'error' && 'copy-page-button--error',
        wide && 'copy-page-button--wide',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleCopy}
      title={label}
      aria-label={label}
    >
      {state === 'copied' ? (
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
