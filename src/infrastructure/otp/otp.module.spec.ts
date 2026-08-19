import { Test } from '@nestjs/testing';
import { OtpModule } from './otp.module';
import { OtpService, LocalOtpService } from './otp.service';
import { EzoneOtpService } from './ezone-otp.service';

describe('OtpModule provider selection', () => {
  const build = async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [OtpModule],
    }).compile();
    return moduleRef.get(OtpService);
  };

  afterEach(() => {
    delete process.env.OTP_PROVIDER;
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
