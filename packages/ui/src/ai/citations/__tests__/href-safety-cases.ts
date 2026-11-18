export const SAFE_CITATION_HREFS: readonly string[] = [
  '/backend/customers/people/123',
  '/kb/refund-policy?version=4#section-2',
  'https://example.com/docs',
  'http://example.com',
  'HTTPS://Example.com/path',
]

export const UNSAFE_CITATION_HREFS: readonly string[] = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  ' javascript:alert(1)',
  'java\tscript:alert(1)',
  'data:text/html;base64,PHNjcmlwdD4=',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  'ftp://example.com',
  'mailto:someone@example.com',
  '//evil.example.com/path',
  '/\\evil.example.com',
  '\\\\evil.example.com',
  'https:evil.example.com',
  'https:/evil.example.com',
  'relative/path',
  '../up',
  '#anchor',
  '',
  'https://exa mple.com',
  '/path\nwith-newline',
  'https://example.com/\u200bhidden',
]

export const NON_STRING_CITATION_HREFS: readonly unknown[] = [undefined, null, 42, {}, ['https://example.com']]
