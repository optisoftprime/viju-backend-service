import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OtpSendResult, OtpService } from './otp.service';

interface EzoneResponse {
  success?: boolean;
  responseCode?: string;
  responseMessage?: string;
}

/**
 * Ezone OTP provider. Ezone generates, SMS-delivers, and validates the code
 * itself (5-minute expiry), so this app never stores or sees the code — it just
 * forwards generate/validate. Configured via EZONE_* env vars.
 */
@Injectable()
export class EzoneOtpService extends OtpService {
  private readonly logger = new Logger(EzoneOtpService.name);

  private get baseUrl(): string {
    const url = process.env.EZONE_OTP_BASE_URL;
    if (!url) throw new Error('EZONE_OTP_BASE_URL is not set');
    return url.replace(/\/+$/, '');
  }

  private get headers(): Record<string, string> {
    const orgKey = process.env.EZONE_ORG_KEY;
    const secretKey = process.env.EZONE_SECRET_KEY;
    if (!orgKey || !secretKey) {
      throw new Error('EZONE_ORG_KEY / EZONE_SECRET_KEY are not set');
    }
    return {
      'Content-Type': 'application/json',
      // x-env is REQUIRED by the gateway (not in the docs). 'test' for the test
      // keys; the live environment value comes from Ezone.
      'x-env': process.env.EZONE_ENV || 'test',
      'x-org-key': orgKey, // the Organization Key (ORG-…)
      'x-secret-key': secretKey, // the Private/Secret Key (sk_…)
    };
  }

  async send(phone: string): Promise<OtpSendResult> {
    const body = await this.post('/generate', {
      phoneNumber: normalisePhone(phone),
    });

    // Ezone reports business outcome in the body; a non-success is a real failure.
    if (body.success !== true || body.responseCode !== '200') {
      this.logger.warn(
        `Ezone generate failed for ${phone}: ${body.responseCode} ${body.responseMessage}`,
      );
      throw new ServiceUnavailableException(
        'Could not send OTP right now. Please try again shortly.',
      );
    }
    // Never expose a code — Ezone owns it and delivers it by SMS.
    return {};
  }

  async verify(phone: string, code: string): Promise<void> {
    const body = await this.post('/validate', {
      phoneNumber: normalisePhone(phone),
      otp: Number(code),
    });

    if (body.success === true && body.responseCode === '200') return;

    if (body.responseCode === '404') {
      // No OTP on record for the number (never requested, or already expired).
      throw new BadRequestException(
        'No OTP found for this number. Please request a new one.',
      );
    }
    throw new UnauthorizedException('Invalid or expired OTP code');
  }

  private async post(path: string, payload: unknown): Promise<EzoneResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
      });
    } catch (error) {
      this.logger.error(
        `Ezone ${path} unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException(
        'OTP service is unreachable. Please try again shortly.',
      );
    }

    // Ezone returns its outcome in the JSON body (with a matching HTTP status).
    const body = (await res.json().catch(() => ({}))) as EzoneResponse;
    return body;
  }
}

/**
 * Ezone's docs show the number both as "234..." and "0..."; we send the E.164
 * digits without the leading '+' (2348…). A stored '+234…' / '0…' is normalised
 * to that. Confirm the exact format Ezone expects if delivery fails.
 */
function normalisePhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('234')) return digits;
  if (digits.startsWith('0')) return `234${digits.slice(1)}`;
  return digits;
}
