import React, { useCallback, useEffect, useState, useRef } from 'react';

function resolveHref(href: string): string {
  if (!href || href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#')) {
    return href;
  }
  try {
    return new URL(href, window.location.origin).href;
  } catch {
    return href;
  }
}

function walkListItem(node: Node, indent: string, prefix: string): string {
  const el = node as HTMLElement;
  const parts: string[] = [];
  let firstLine = '';

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as HTMLElement;
      const childTag = childEl.tagName.toLowerCase();
      if (childTag === 'ul') {
        const nestedItems = Array.from(childEl.children)
          .map((li, i) => walkListItem(li, indent + '  ', '- '))
          .join('\n');
        parts.push(nestedItems);
        continue;
      }
      if (childTag === 'ol') {
        const nestedItems = Array.from(childEl.children)
          .map((li, i) => walkListItem(li, indent + '  ', `${i + 1}. `))
          .join('\n');
        parts.push(nestedItems);
        continue;
      }
    }
    firstLine += walk(child);
  }

  const result = `${indent}${prefix}${firstLine.trim()}`;
  if (parts.length > 0) {
    return `${result}\n${parts.join('\n')}`;
  }
  return result;
}

function walk(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  // Skip elements that should not be in the copied content
  if (
    el.closest('[data-copy-page-button]') ||
    el.hasAttribute('hidden') ||
    tag === 'nav' ||
    tag === 'svg' ||
    el.classList.contains('table-of-contents') ||
    el.classList.contains('theme-doc-toc-desktop') ||
    el.classList.contains('theme-doc-toc-mobile') ||
    el.classList.contains('pagination-nav') ||
    el.classList.contains('theme-doc-footer') ||
    el.classList.contains('theme-last-updated') ||
    el.classList.contains('theme-doc-breadcrumbs') ||
    el.classList.contains('docusaurus-mermaid-container')
  ) {
    return '';
  }

  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = parseInt(tag[1], 10);
      const prefix = '#'.repeat(level);
      const text = Array.from(el.childNodes)
        .filter((n) => {
          if (n.nodeType === Node.ELEMENT_NODE) {
            const c = n as HTMLElement;
            return !c.classList.contains('hash-link') && c.tagName.toLowerCase() !== 'a' || c.getAttribute('href')?.[0] !== '#' || c.textContent?.trim() !== '';
          }
          return true;
        })
        .map(walk)
        .join('')
        .trim();
      return `${prefix} ${text}\n\n`;
    }
    case 'p':
      return `${Array.from(el.childNodes).map(walk).join('').trim()}\n\n`;
    case 'strong':
    case 'b':
      return `**${Array.from(el.childNodes).map(walk).join('')}**`;
    case 'em':
    case 'i':
      return `*${Array.from(el.childNodes).map(walk).join('')}*`;
    case 'code': {
      if (!el.closest('pre')) {
        return `\`${el.textContent || ''}\``;
      }
      return el.textContent || '';
    }
    case 'pre': {
      const codeEl = el.querySelector('code');
      // Language class is on <pre> in Docusaurus (prism-react-renderer), not on <code>
      const langMatch =
        el.className.match(/language-([\w-]+)/) ||
        el.closest('[class*="language-"]')?.className.match(/language-([\w-]+)/);
      const lang = langMatch?.[1] || '';

      let code: string;
      if (codeEl) {
        // Docusaurus renders code lines as <span class="token-line"> with no newlines
        const tokenLines = codeEl.querySelectorAll('.token-line');
        if (tokenLines.length > 0) {
          code = Array.from(tokenLines)
            .map((line) => line.textContent)
            .join('\n');
        } else {
          code = codeEl.textContent || '';
        }
      } else {
        code = el.textContent || '';
      }
      return `\`\`\`${lang}\n${code.trimEnd()}\n\`\`\`\n\n`;
    }
    case 'a': {
      const href = el.getAttribute('href') || '';
      if (el.classList.contains('hash-link') || href === '#') {
        return '';
      }
      const children = Array.from(el.childNodes).map(walk).join('');
      return `[${children}](${resolveHref(href)})`;
    }
    case 'ul': {
      const items = Array.from(el.children)
        .map((li) => walkListItem(li, '', '- '))
        .join('\n');
      return `${items}\n\n`;
    }
    case 'ol': {
      const items = Array.from(el.children)
        .map((li, i) => walkListItem(li, '', `${i + 1}. `))
        .join('\n');
      return `${items}\n\n`;
    }
    case 'li':
      return Array.from(el.childNodes).map(walk).join('');
    case 'blockquote':
      return (
        Array.from(el.childNodes)
          .map(walk)
          .join('')
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
          walk(cell).trim().replace(/\n/g, ' ').replace(/\|/g, '\\|'),
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
      return `![${alt}](${resolveHref(src)})`;
    }
    case 'details': {
      const summary = el.querySelector(':scope > summary');
      const summaryText = summary ? walk(summary).trim() : '';
      const rest = Array.from(el.childNodes)
        .filter((n) => n !== summary)
        .map(walk)
        .join('');
      return `<details>\n<summary>${summaryText}</summary>\n\n${rest.trim()}\n</details>\n\n`;
    }
    case 'summary':
      return Array.from(el.childNodes).map(walk).join('');
    default: {
      // Handle admonitions: emit as blockquote with type label
      if (el.classList.contains('theme-admonition')) {
        const typeMatch = Array.from(el.classList).find((c) => c.startsWith('alert--'));
        const type = typeMatch ? typeMatch.replace('alert--', '').toUpperCase() : 'NOTE';
        const titleEl = el.querySelector('.admonitionHeading_node_modules-\\@docusaurus-theme-classic-lib-theme-Admonition-Layout-styles-module, .admonition-title, [class*="admonitionHeading"]');
        const title = titleEl?.textContent?.trim() || type;
        const bodyParts: string[] = [];
        for (const child of Array.from(el.childNodes)) {
          if (child === titleEl || (child as HTMLElement).classList?.contains?.('admonitionHeading')) continue;
          bodyParts.push(walk(child));
        }
        const body = bodyParts.join('').trim();
        return `> **${title}**\n>\n${body.split('\n').map((l) => `> ${l}`).join('\n')}\n\n`;
      }
      return Array.from(el.childNodes).map(walk).join('');
    }
  }
}

export function htmlToMarkdown(element: Element): string {
  return walk(element)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function CopyPageButton(): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    // Docusaurus puts theme-doc-markdown on a <div> inside <article>, not on <article> itself
    const articleEl =
      document.querySelector('.theme-doc-markdown') ||
      document.querySelector('article');
    if (!articleEl) return;

    const markdown = htmlToMarkdown(articleEl);

    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = markdown;
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
      <span className="copy-page-button__label" role="status" aria-live="polite">
        {copied ? 'Copied!' : 'Copy page'}
      </span>
    </button>
  );
}
