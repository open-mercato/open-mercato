import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useDoc } from '@docusaurus/plugin-content-docs/client';

export default function CopyPageButton(): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { metadata } = useDoc();

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    // Derive the raw MDX path from the doc source file path
    // metadata.source looks like "@site/docs/user-guide/overview.mdx"
    const sourcePath = metadata.source?.replace('@site/docs/', '') || '';
    if (!sourcePath) return;

    try {
      const response = await fetch(`/raw/${sourcePath}`);
      if (!response.ok) return;

      const mdxContent = await response.text();

      try {
        await navigator.clipboard.writeText(mdxContent);
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = mdxContent;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      setCopied(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail if fetch fails
    }
  }, [metadata.source]);

  return (
    <button
      data-copy-page-button
      type="button"
      className={`copy-page-button ${copied ? 'copy-page-button--copied' : ''}`}
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy page as Markdown'}
      aria-label={copied ? 'Copied!' : 'Copy page as Markdown'}
    >
      {copied ? (
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
        {copied ? 'Copied!' : 'Copy page'}
      </span>
    </button>
  );
}
