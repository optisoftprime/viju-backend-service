export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body. */
  body: string;
  /** Optional HTML body. If absent, providers fall back to `body`. */
  html?: string;
  /** Optional reply-to override. */
  replyTo?: string;
}

export abstract class EmailService {
  /**
   * Sends `message`. Implementations MUST NOT throw — provider failures
   * are logged but never bubble up to the calling business flow.
   * A success/failure flag would be nice; for now: fire-and-forget.
   */
  abstract send(message: EmailMessage): Promise<void>;
}
