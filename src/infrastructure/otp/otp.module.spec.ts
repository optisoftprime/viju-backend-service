import { Test } from '@nestjs/testing';
import { OtpModule } from './otp.module';
import { OtpService, LocalOtpService } from './otp.service';
import { EzoneOtpService } from './ezone-otp.service';
import { PrismaService } from '../database/prisma.service';

describe('OtpModule provider selection', () => {
  const originalProvider = process.env.OTP_PROVIDER;

  /**
   * PrismaService is stubbed out deliberately. Constructing a real
   * PrismaClient makes Prisma load `.env` into process.env, which would put
   * OTP_PROVIDER back after a test had cleared it — so the "unset" case would
   * silently assert whatever the developer happens to have in their own .env
   * rather than the documented default.
   */
  const build = async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [OtpModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    return moduleRef.get(OtpService);
  };

  afterEach(() => {
    delete process.env.OTP_PROVIDER;
  });

  afterAll(() => {
    if (originalProvider === undefined) delete process.env.OTP_PROVIDER;
    else process.env.OTP_PROVIDER = originalProvider;
  });

  it('resolves LocalOtpService by default', async () => {
    delete process.env.OTP_PROVIDER;
    expect(await build()).toBeInstanceOf(LocalOtpService);
  });

  it('resolves LocalOtpService when OTP_PROVIDER=local', async () => {
    process.env.OTP_PROVIDER = 'local';
    expect(await build()).toBeInstanceOf(LocalOtpService);
  });

  it('resolves EzoneOtpService when OTP_PROVIDER=ezone', async () => {
    process.env.OTP_PROVIDER = 'ezone';
    expect(await build()).toBeInstanceOf(EzoneOtpService);
  });
});
