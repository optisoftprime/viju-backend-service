import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { DEACTIVATED_ACCOUNT_MESSAGE } from './auth.constants';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      // Two sources, in priority order:
      //   1. Authorization: Bearer — every client, every route
      //   2. ?token= — browser EventSource on GET /realtime/stream, which
      //      cannot set request headers. Same token, same validation.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('token'),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(
        'JWT_SECRET',
        'super-secret-key-123',
      ),
    });
  }

  async validate(payload: any) {
    let user: any = null;

    if (payload.type === 'CUSTOMER') {
      const customer = await this.prisma.customer.findUnique({
        where: { id: payload.sub },
      });
      if (customer) {
        user = { ...customer, role: 'CUSTOMER' };
      }
    } else if (payload.type === 'STAFF') {
      user = await this.prisma.staff.findUnique({ where: { id: payload.sub } });
    }

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // US-15.5: a deactivated officer's live session must die. The access
    // token stays cryptographically valid until it expires, so the check has
    // to happen here, on every request, not only at login.
    if (payload.type === 'STAFF' && user.isActive === false) {
      throw new UnauthorizedException(DEACTIVATED_ACCOUNT_MESSAGE);
    }

    // Check customer account status
    if (payload.type === 'CUSTOMER' && user.accountStatus === 'ON_HOLD') {
      throw new UnauthorizedException('Customer account is on hold');
    }

    return user;
  }
}
