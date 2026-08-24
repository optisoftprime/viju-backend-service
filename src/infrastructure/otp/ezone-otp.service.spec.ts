import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { EzoneOtpService } from './ezone-otp.service';

describe('EzoneOtpService', () => {
  let svc: EzoneOtpService;
  let fetchMock: jest.Mock;

  const ok = (body: unknown) =>
    Promise.resolve({ json: () => Promise.resolve(body) } as Response);

  const EZONE_ENV_KEYS = [
    'EZONE_OTP_BASE_URL',
    'EZONE_ENV',
    'EZONE_ORG_KEY',
    'EZONE_SECRET_KEY',
    'EZONE_ORGANIZATION_KEY',
    'PRIVATE_EZONE_SECRET_KEY',
  ];

  beforeEach(() => {
    for (const key of EZONE_ENV_KEYS) delete process.env[key];
    process.env.EZONE_OTP_BASE_URL = 'https://ezone.test/api/v1/otp';
    process.env.EZONE_ENV = 'test';
    process.env.EZONE_ORG_KEY = 'org-key';
    process.env.EZONE_SECRET_KEY = 'secret-key';
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    svc = new EzoneOtpService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of EZONE_ENV_KEYS) delete process.env[key];
  });

  it('sends with org/secret headers and normalises the phone to 234…', async () => {
    fetchMock.mockReturnValue(ok({ success: true, responseCode: '200' }));

    await svc.send('+2348168584112');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ezone.test/api/v1/otp/generate');
    expect(init.headers['x-env']).toBe('test');
    expect(init.headers['x-org-key']).toBe('org-key');
    expect(init.headers['x-secret-key']).toBe('secret-key');
    expect(JSON.parse(init.body)).toEqual({ phoneNumber: '2348168584112' });
  });

  it('normalises a 0-prefixed number to 234…', async () => {
    fetchMock.mockReturnValue(ok({ success: true, responseCode: '200' }));
    await svc.send('08036443423');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).phoneNumber).toBe(
      '2348036443423',
    );
  });

  it('throws ServiceUnavailable when generate is not successful', async () => {
    fetchMock.mockReturnValue(ok({ success: false, responseCode: '400' }));
    await expect(svc.send('+2348168584112')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('throws ServiceUnavailable when Ezone is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(svc.send('+2348168584112')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('verify resolves on success and sends the otp as a number', async () => {
    fetchMock.mockReturnValue(ok({ success: true, responseCode: '200' }));
    await expect(
      svc.verify('+2348168584112', '123456'),
    ).resolves.toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      phoneNumber: '2348168584112',
      otp: 123456,
    });
  });

  it('verify maps 404 to BadRequest (no OTP on record)', async () => {
    fetchMock.mockReturnValue(ok({ success: false, responseCode: '404' }));
    await expect(svc.verify('+2348168584112', '123456')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('verify maps any other failure to Unauthorized', async () => {
    fetchMock.mockReturnValue(ok({ success: false, responseCode: '500' }));
    await expect(svc.verify('+2348168584112', '000000')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  describe('credential env names', () => {
    /** Only the names under test are set, so a fallback cannot mask a miss. */
    const withCredentials = (env: Record<string, string>) => {
      for (const key of EZONE_ENV_KEYS) delete process.env[key];
      process.env.EZONE_OTP_BASE_URL = 'https://ezone.test/api/v1/otp';
      process.env.EZONE_ENV = 'test';
      Object.assign(process.env, env);
      fetchMock.mockReturnValue(ok({ success: true, responseCode: '200' }));
      return new EzoneOtpService();
    };

    it('reads the dashboard-labelled names the environment uses', async () => {
      const service = withCredentials({
        EZONE_ORGANIZATION_KEY: 'ORG-1786107',
        PRIVATE_EZONE_SECRET_KEY: 'sk_test_abc',
      });

      await service.send('+2348168584112');

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers['x-org-key']).toBe('ORG-1786107');
      expect(headers['x-secret-key']).toBe('sk_test_abc');
    });

    it('still reads the original shorter names, so a live deploy keeps working', async () => {
      const service = withCredentials({
        EZONE_ORG_KEY: 'org-key',
        EZONE_SECRET_KEY: 'sk_test_legacy',
      });

      await service.send('+2348168584112');

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers['x-org-key']).toBe('org-key');
      expect(headers['x-secret-key']).toBe('sk_test_legacy');
    });

    it('prefers the dashboard-labelled name when both are set', async () => {
      const service = withCredentials({
        EZONE_ORGANIZATION_KEY: 'ORG-new',
        EZONE_ORG_KEY: 'org-old',
        PRIVATE_EZONE_SECRET_KEY: 'sk_test_new',
        EZONE_SECRET_KEY: 'sk_test_old',
      });

      await service.send('+2348168584112');

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers['x-org-key']).toBe('ORG-new');
      expect(headers['x-secret-key']).toBe('sk_test_new');
    });

    it('refuses a PUBLIC key in the secret slot', async () => {
      // Both keys sit in the environment under near-identical names; sending
      // pk_ would fail at the gateway with nothing pointing at the cause.
      const service = withCredentials({
        EZONE_ORGANIZATION_KEY: 'ORG-1786107',
        PRIVATE_EZONE_SECRET_KEY: 'pk_test_publickey',
      });

      await expect(service.send('+2348168584112')).rejects.toThrow(
        /PUBLIC key/,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('names both accepted spellings when the credentials are missing', async () => {
      const service = withCredentials({});

      await expect(service.send('+2348168584112')).rejects.toThrow(
        /EZONE_ORGANIZATION_KEY.*PRIVATE_EZONE_SECRET_KEY/s,
      );
    });
  });
});
