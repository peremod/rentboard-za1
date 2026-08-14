/**
 * Escapes text for safe interpolation into an HTML string.
 *
 * NotificationsService builds every email as a raw HTML template string —
 * user-supplied values (names, room titles, message previews, rejection
 * reasons) are interpolated directly into that HTML. Without this, stored
 * text containing e.g. `<img src=x onerror=...>` would execute in the
 * recipient's mail client. This is the actual exploitable boundary — more
 * so than the database write itself, since most mail clients render HTML
 * email by default. Apply this to every dynamic value passed into any
 * NotificationsService template, no exceptions.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
