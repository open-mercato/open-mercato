import React, { useCallback, useRef, useState } from 'react';
import { useDoc } from '@docusaurus/plugin-content-docs/client';
import styles from './CopyPageButton.module.css';

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default function CopyPageButton(): React.ReactElement | null {
  const { frontMatter } = useDoc();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rawSourceEncoded = (frontMatter as Record<string, unknown>).raw_source;

  const handleCopy = useCallback(async () => {
    if (typeof rawSourceEncoded !== 'string') return;

    const decoded = atob(rawSourceEncoded);
    await navigator.clipboard.writeText(decoded);
    setCopied(true);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [rawSourceEncoded]);

  if (typeof rawSourceEncoded !== 'string' || typeof navigator?.clipboard?.writeText !== 'function') {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.copyButton} ${copied ? styles.copied : ''}`}
        onClick={handleCopy}
        aria-label="Copy page as Markdown"
        title="Copy page as Markdown"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      {copied && (
        <span className={styles.srOnly} aria-live="polite">
          Copied to clipboard
        </span>
      )}
    </>
  );
}
