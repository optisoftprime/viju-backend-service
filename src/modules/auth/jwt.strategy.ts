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
      secretOrKey: configService.get<string>('JWT_SECRET', 'super-secret-key-123'),
    });
  }

  async validate(payload: any) {
    let user: any = null;
    
    if (payload.type === 'CUSTOMER') {
      const customer = await this.prisma.customer.findUnique({ where: { id: payload.sub } });
      if (customer) {
        user = { ...customer, role: 'CUSTOMER' };
      }
    } else if (payload.type === 'STAFF') {
      user = await this.prisma.staff.findUnique({ where: { id: payload.sub } });
    }

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Check staff active status
    if (payload.type === 'STAFF' && user.isActive === false) {
      throw new UnauthorizedException('Staff account is inactive');
    }

    // Check customer account status
    if (payload.type === 'CUSTOMER' && user.accountStatus === 'ON_HOLD') {
      throw new UnauthorizedException('Customer account is on hold');
    }

    return user;
  }
}
