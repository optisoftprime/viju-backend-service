import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  RequestOtpDto,
  VerifyOtpDto,
  CustomerLoginDto,
  StaffLoginDto,
  StaffWebLoginDto,
  StaffPasswordResetRequestDto,
  StaffPasswordResetConfirmDto,
  RefreshTokenDto,
  LogoutDto,
} from './dto/auth.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('customer/request-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request SMS OTP for customer registration/login' })
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto);
  }

  @Post('customer/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP and set password' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Post('customer/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer login via phone and password' })
  async customerLogin(@Body() dto: CustomerLoginDto) {
    return this.authService.customerLogin(dto);
  }

  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Legacy: Staff login via email and password',
    description:
      'Retained for transition. New web portal uses /auth/staff/web-login.',
  })
  async staffLogin(@Body() dto: StaffLoginDto) {
    return this.authService.staffLogin(dto);
  }

  @Post('staff/web-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Staff web-portal login via ERP username + code (PRD F11/F14)',
    description:
      'Officers, regional admins and administrators sign in to the web portal using credentials issued by the ERP. The platform validates against ERP, upserts a local Staff row, and returns a JWT.',
  })
  async staffWebLogin(@Body() dto: StaffWebLoginDto) {
    return this.authService.staffWebLogin(dto);
  }

  @Post('staff/password-reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Staff password reset - request OTP (PRD F18 #7)',
    description:
      'Send a 6-digit OTP to the officer/admin via SMS (phone) or email. Always returns success message regardless of whether the account exists, to avoid leaking valid identifiers.',
  })
  async requestStaffPasswordReset(@Body() dto: StaffPasswordResetRequestDto) {
    return this.authService.requestStaffPasswordReset(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new access + refresh pair',
    description:
      'Refresh tokens are single-use — successful refresh rotates the token, ' +
      'the previous one is marked revoked. Reusing an already-revoked refresh ' +
      'token revokes the entire chain and forces re-login (theft defence).',
  })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refresh_token);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke a refresh token (logout this session)',
    description:
      'Pass the refresh_token from your login response. Access tokens stay ' +
      'valid until their own short expiry; the refresh token is revoked so ' +
      'no further access tokens can be minted from it.',
  })
  async logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto.refresh_token);
  }

  @Post('staff/password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Staff password reset - submit OTP and set new password',
  })
  async confirmStaffPasswordReset(@Body() dto: StaffPasswordResetConfirmDto) {
    return this.authService.confirmStaffPasswordReset(dto);
  }
}
