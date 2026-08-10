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

  beforeEach(() => {
    process.env.EZONE_OTP_BASE_URL = 'https://ezone.test/api/v1/otp';
    process.env.EZONE_ENV = 'test';
    process.env.EZONE_ORG_KEY = 'org-key';
    process.env.EZONE_SECRET_KEY = 'secret-key';
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    svc = new EzoneOtpService();
  });

  afterEach(() => jest.restoreAllMocks());

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
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).phoneNumber).toBe('2348036443423');
  });

  it('throws ServiceUnavailable when generate is not successful', async () => {
    fetchMock.mockReturnValue(ok({ success: false, responseCode: '400' }));
    await expect(svc.send('+2348168584112')).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws ServiceUnavailable when Ezone is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(svc.send('+2348168584112')).rejects.toThrow(ServiceUnavailableException);
  });

  it('verify resolves on success and sends the otp as a number', async () => {
    fetchMock.mockReturnValue(ok({ success: true, responseCode: '200' }));
    await expect(svc.verify('+2348168584112', '123456')).resolves.toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      phoneNumber: '2348168584112',
      otp: 123456,
    });
  });

  it('verify maps 404 to BadRequest (no OTP on record)', async () => {
    fetchMock.mockReturnValue(ok({ success: false, responseCode: '404' }));
    await expect(svc.verify('+2348168584112', '123456')).rejects.toThrow(BadRequestException);
  });

  it('verify maps any other failure to Unauthorized', async () => {
    fetchMock.mockReturnValue(ok({ success: false, responseCode: '500' }));
    await expect(svc.verify('+2348168584112', '000000')).rejects.toThrow(UnauthorizedException);
  });
});
