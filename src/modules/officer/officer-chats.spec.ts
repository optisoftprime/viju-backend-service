import {
  ATTACHMENT_PREVIEW,
  MESSAGE_PREVIEW_LENGTH,
  messagePreview,
} from '../../common/messaging/message-preview';
import { compareBy } from '../../common/pagination/sort.dto';

/**
 * CH-1 / CH-3 — the conversation list.
 *
 * The preview rules are pinned because they are what a row renders; the
 * ordering rule is pinned because the client's original concern (NULLs
 * floating to the top of a DESC sort) is a real failure mode that would put
 * every silent conversation above every live one.
 */
describe('Conversation list (CH-1, CH-3)', () => {
  describe('CH-1 — message preview', () => {
    it('returns the message text', () => {
      expect(
        messagePreview({
          content: 'Has my waybill been assigned?',
          attachmentUrl: null,
        }),
      ).toBe('Has my waybill been assigned?');
    });

    it('returns null on an empty thread', () => {
      expect(messagePreview(null)).toBeNull();
      expect(messagePreview(undefined)).toBeNull();
    });

    it('names an attachment-only message rather than previewing blank', () => {
      // An empty string would make the row look broken.
      expect(
        messagePreview({
          content: null,
          attachmentUrl: 'https://cdn/x.pdf',
        }),
      ).toBe(ATTACHMENT_PREVIEW);
      expect(
        messagePreview({ content: '   ', attachmentUrl: 'https://cdn/x.pdf' }),
      ).toBe(ATTACHMENT_PREVIEW);
    });

    it('prefers real text over the attachment label', () => {
      expect(
        messagePreview({
          content: 'Here is the waybill',
          attachmentUrl: 'https://cdn/x.pdf',
        }),
      ).toBe('Here is the waybill');
    });

    it('collapses newlines so the row stays one line', () => {
      // A pasted multi-line message would otherwise render as a ragged
      // fragment of its first line.
      expect(
        messagePreview({
          content: 'Line one\n\nLine two\t  Line three',
          attachmentUrl: null,
        }),
      ).toBe('Line one Line two Line three');
    });

    it('truncates at 120 characters with an ellipsis', () => {
      const long = 'a'.repeat(400);
      const preview = messagePreview({ content: long, attachmentUrl: null });

      expect(preview).toHaveLength(MESSAGE_PREVIEW_LENGTH);
      expect(preview?.endsWith('…')).toBe(true);
    });

    it('leaves a message exactly at the limit untouched', () => {
      const exact = 'b'.repeat(MESSAGE_PREVIEW_LENGTH);
      expect(messagePreview({ content: exact, attachmentUrl: null })).toBe(
        exact,
      );
    });

    it('returns null for a message with neither text nor attachment', () => {
      expect(messagePreview({ content: '', attachmentUrl: null })).toBeNull();
    });
  });

  describe('CH-3(b) — ordering by recency', () => {
    // The client's worry was that a DESC sort would float never-messaged rows
    // to the top, because SQL orders NULLs first on DESC. This sort runs in
    // memory through compareBy, which puts nulls last in BOTH directions.
    const rows = [
      { name: 'never messaged', lastMessageAt: null },
      { name: 'older', lastMessageAt: new Date('2026-08-20T10:00:00Z') },
      { name: 'newest', lastMessageAt: new Date('2026-08-27T08:12:00Z') },
    ];

    it('puts the most recent conversation first', () => {
      const sorted = [...rows].sort(compareBy((r) => r.lastMessageAt, 'desc'));
      expect(sorted.map((r) => r.name)).toEqual([
        'newest',
        'older',
        'never messaged',
      ]);
    });

    it('sinks a null rather than floating it, on ASC too', () => {
      const sorted = [...rows].sort(compareBy((r) => r.lastMessageAt, 'asc'));
      expect(sorted[sorted.length - 1].name).toBe('never messaged');
    });
  });
});
