export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export abstract class EmailService {
  abstract send(message: EmailMessage): Promise<void>;
}
