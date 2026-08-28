/**
 * CH-1 — the one-line excerpt a conversation row shows under the name.
 *
 * Shared by GET /officers/customers and GET /officers/chats so the two screens
 * can never render the same thread differently.
 */

/** How much of the message a row shows. Longer is truncated, never wrapped. */
export const MESSAGE_PREVIEW_LENGTH = 120;

/**
 * What an attachment-only message previews as.
 *
 * A message can carry a file and no text. Previewing that as an empty string
 * would make the row look like a bug; naming it tells the officer there is
 * something to open.
 */
export const ATTACHMENT_PREVIEW = '📎 Attachment';

/** The shape a preview is built from — the two columns that decide it. */
export interface PreviewableMessage {
  content: string | null;
  attachmentUrl: string | null;
}

/**
 * Builds the preview for one message, or null when there is no message.
 *
 * Newlines and runs of whitespace collapse to single spaces: the row is one
 * line, and a pasted multi-line message would otherwise render as a ragged
 * fragment of its first line. Truncation adds an ellipsis so a cut-off
 * sentence reads as cut off rather than as the whole message.
 */
export function messagePreview(
  message: PreviewableMessage | null | undefined,
): string | null {
  if (!message) return null;

  const text = (message.content ?? '').replace(/\s+/g, ' ').trim();
  if (text === '') {
    // No text at all: an attachment if there is one, otherwise nothing worth
    // showing. An empty message with no attachment should not exist, but
    // returning null is safer than rendering a blank row.
    return message.attachmentUrl ? ATTACHMENT_PREVIEW : null;
  }

  return text.length > MESSAGE_PREVIEW_LENGTH
    ? `${text.slice(0, MESSAGE_PREVIEW_LENGTH - 1).trimEnd()}…`
    : text;
}
