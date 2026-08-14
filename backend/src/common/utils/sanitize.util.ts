import sanitizeHtml from 'sanitize-html';

/**
 * Strips ALL markup from user-supplied free text before it's stored —
 * every field this touches (message body, room description, application
 * cover note, rejection reason) is plain text by design; none of them are
 * meant to support rich formatting. Defense in depth: even though the
 * frontend also never renders these via [innerHTML], this guarantees the
 * database itself never holds executable markup, regardless of what reads
 * it later (a future admin tool, an export, a different client).
 */
export function sanitizeText(input: string): string {
  return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} }).trim();
}
