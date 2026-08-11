import React, { useCallback, useState, useRef } from 'react';

function htmlToMarkdown(element: Element): string {
  const lines: string[] = [];

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    // Skip the copy button itself, nav elements, and table of contents
    if (
      el.closest('[data-copy-page-button]') ||
      tag === 'nav' ||
      el.classList.contains('table-of-contents') ||
      el.classList.contains('theme-doc-toc-desktop') ||
      el.classList.contains('theme-doc-toc-mobile') ||
      el.classList.contains('pagination-nav') ||
      el.classList.contains('theme-doc-footer') ||
      el.classList.contains('theme-last-updated') ||
      el.classList.contains('theme-doc-breadcrumbs')
    ) {
      return '';
    }

    const children = Array.from(el.childNodes).map(walk).join('');

    switch (tag) {
      case 'h1':
        return `# ${children.trim()}\n\n`;
      case 'h2':
        return `## ${children.trim()}\n\n`;
      case 'h3':
        return `### ${children.trim()}\n\n`;
      case 'h4':
        return `#### ${children.trim()}\n\n`;
      case 'h5':
        return `##### ${children.trim()}\n\n`;
      case 'h6':
        return `###### ${children.trim()}\n\n`;
      case 'p':
        return `${children.trim()}\n\n`;
      case 'strong':
      case 'b':
        return `**${children}**`;
      case 'em':
      case 'i':
        return `*${children}*`;
      case 'code': {
        // Inline code (not inside pre)
        if (!el.closest('pre')) {
          return `\`${children}\``;
        }
        return children;
      }
      case 'pre': {
        const codeEl = el.querySelector('code');
        const lang = codeEl?.className?.match(/language-(\w+)/)?.[1] || '';
        const code = codeEl?.textContent || children;
        return `\`\`\`${lang}\n${code.trim()}\n\`\`\`\n\n`;
      }
      case 'a': {
        const href = el.getAttribute('href') || '';
        // Skip anchor links that are just "#"
        if (el.classList.contains('hash-link') || href === '#') {
          return '';
        }
        return `[${children}](${href})`;
      }
      case 'ul': {
        const items = Array.from(el.children)
          .map((li) => `- ${walk(li).trim()}`)
          .join('\n');
        return `${items}\n\n`;
      }
      case 'ol': {
        const items = Array.from(el.children)
          .map((li, i) => `${i + 1}. ${walk(li).trim()}`)
          .join('\n');
        return `${items}\n\n`;
      }
      case 'li':
        return children;
      case 'blockquote':
        return (
          children
            .trim()
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n') + '\n\n'
        );
      case 'table': {
        const rows = Array.from(el.querySelectorAll('tr'));
        if (rows.length === 0) return '';

        const tableLines: string[] = [];
        rows.forEach((row, rowIndex) => {
          const cells = Array.from(row.querySelectorAll('th, td')).map((cell) =>
            walk(cell).trim().replace(/\n/g, ' '),
          );
          tableLines.push(`| ${cells.join(' | ')} |`);
          if (rowIndex === 0) {
            tableLines.push(`| ${cells.map(() => '---').join(' | ')} |`);
          }
        });
        return `${tableLines.join('\n')}\n\n`;
      }
      case 'br':
        return '\n';
      case 'hr':
        return '---\n\n';
      case 'img': {
        const alt = el.getAttribute('alt') || '';
        const src = el.getAttribute('src') || '';
        return `![${alt}](${src})`;
      }
      case 'details': {
        const summary = el.querySelector('summary');
        const summaryText = summary ? walk(summary).trim() : '';
        const rest = Array.from(el.childNodes)
          .filter((n) => n !== summary)
          .map(walk)
          .join('');
        return `<details>\n<summary>${summaryText}</summary>\n\n${rest.trim()}\n</details>\n\n`;
      }
      case 'summary':
        return children;
      default:
        return children;
    }
  }

  lines.push(walk(element));

  return lines
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function CopyPageButton(): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const handleCopy = useCallback(async () => {
    const articleEl = document.querySelector('article.theme-doc-markdown');
    if (!articleEl) return;

    const markdown = htmlToMarkdown(articleEl);

    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = markdown;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }, []);

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
      <span className="copy-page-button__label">{copied ? 'Copied!' : 'Copy page'}</span>
    </button>
  );
}
