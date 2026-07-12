declare module 'html-to-docx' {
  export type HTMLtoDOCXResult = Buffer | Uint8Array | ArrayBuffer | Blob

  export default function HTMLtoDOCX(
    htmlString: string,
    headerHTMLString?: string | null,
    documentOptions?: Record<string, unknown>,
    footerHTMLString?: string | null,
  ): Promise<HTMLtoDOCXResult>
}
