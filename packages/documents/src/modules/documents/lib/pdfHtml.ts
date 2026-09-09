const PDF_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildDocumentPdfHtml(title: string, contentHtml: string): string {
  const safeTitle = escapeHtml(title)
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${PDF_CSP}">
  <title>${safeTitle}</title>
  <style>
    @page { size: A4; margin: 22mm 20mm; }
    *, *::before, *::after { box-sizing: border-box; }
    html { color: #172033; background: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 11pt; line-height: 1.55; }
    body { margin: 0; overflow-wrap: anywhere; }
    .document-title { margin: 0 0 9mm; color: #111827; font-size: 25pt; font-weight: 650; line-height: 1.18; }
    .document-content > :first-child { margin-top: 0; }
    .document-content > :last-child { margin-bottom: 0; }
    h1, h2, h3, h4, h5, h6 { break-after: avoid-page; color: #111827; font-weight: 650; line-height: 1.25; }
    h1 { margin: 8mm 0 3mm; font-size: 21pt; }
    h2 { margin: 7mm 0 2.5mm; font-size: 17pt; }
    h3 { margin: 6mm 0 2mm; font-size: 14pt; }
    h4, h5, h6 { margin: 5mm 0 2mm; font-size: 11.5pt; }
    p { margin: 0 0 3.5mm; }
    ul, ol { margin: 0 0 4mm; padding-left: 7mm; }
    li { margin: 1mm 0; padding-left: 1mm; }
    li > p { margin: 0; }
    ul:has(input[type="checkbox"]) { list-style: none; padding-left: 0; }
    ul:has(input[type="checkbox"]) li { display: flex; align-items: flex-start; gap: 2.5mm; padding-left: 0; }
    ul:has(input[type="checkbox"]) li > label { flex: none; padding-top: 0.5mm; }
    ul:has(input[type="checkbox"]) li > div { min-width: 0; flex: 1; }
    input[type="checkbox"] { width: 3.5mm; height: 3.5mm; margin: 0; accent-color: #4f46e5; }
    blockquote { margin: 5mm 0; border-left: 1.2mm solid #cbd5e1; padding: 1mm 0 1mm 5mm; color: #475569; }
    pre { margin: 5mm 0; border: 0.25mm solid #dbe3ee; border-radius: 1.5mm; background: #f8fafc; padding: 4mm; break-inside: avoid-page; color: #172033; font: 9.5pt/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; }
    code { border-radius: 1mm; background: #f1f5f9; padding: 0.2mm 1mm; font: 0.9em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    pre code { background: transparent; padding: 0; font: inherit; }
    a { color: #4338ca; text-decoration: underline; text-underline-offset: 1px; }
    span[style*="background-color"] { border-radius: 0.5mm; padding: 0 0.4mm; }
    hr { margin: 7mm 0; border: 0; border-top: 0.25mm solid #cbd5e1; }
    img { display: block; max-width: 100%; height: auto; margin: 5mm auto; break-inside: avoid-page; }
    table { width: 100%; margin: 5mm 0; border-collapse: collapse; table-layout: fixed; font-size: 9.5pt; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { break-inside: avoid-page; }
    th, td { border: 0.25mm solid #94a3b8; padding: 2.5mm 3mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    th { background: #eef2f7; color: #111827; font-weight: 650; }
    strong > code:only-child { background: transparent; padding: 0; font: inherit; }
    strong > code:only-child > span:only-child { display: inline-block; max-width: 100%; border: 0.25mm solid #a5b4fc; border-radius: 1.2mm; background: #eef2ff; padding: 0.15mm 1.5mm; break-inside: avoid-page; color: #3730a3; font-weight: 600; line-height: 1.55; text-decoration: none; vertical-align: baseline; }
  </style>
</head>
<body>
  <h1 class="document-title">${safeTitle}</h1>
  <main class="document-content">${contentHtml}</main>
</body>
</html>`
}
