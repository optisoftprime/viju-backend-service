import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(
        'JWT_SECRET',
        'super-secret-key-123',
      ),
    });
  }

  async validate(payload: any) {
    let user = null;

    if (payload.type === 'CUSTOMER') {
      user = await this.prisma.customer.findUnique({
        where: { id: payload.sub },
      });
      if (user) user.role = 'CUSTOMER';
    } else if (payload.type === 'STAFF') {
      user = await this.prisma.staff.findUnique({ where: { id: payload.sub } });
    }

    if (!user || user.isActive === false || user.accountStatus === 'ON_HOLD') {
      throw new UnauthorizedException();
    }

    return user;
  }
}
