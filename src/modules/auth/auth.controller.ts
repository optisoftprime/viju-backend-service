import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  RequestOtpDto,
  VerifyOtpDto,
  CustomerLoginDto,
  StaffLoginDto,
  StaffWebLoginDto,
  StaffPasswordResetRequestDto,
  StaffPasswordResetConfirmDto,
  StaffPasswordResetVerifyOtpDto,
  StaffPasswordResetWithTokenDto,
  RefreshTokenDto,
  LogoutDto,
} from './dto/auth.dto';
import {
  AuthTokenResponseDto,
  RequestOtpResponseDto,
  StaffPasswordResetRequestResponseDto,
  StaffPasswordResetVerifyOtpResponseDto,
} from './dto/auth-response.dto';
import { MessageResponseDto } from '../../common/dto/message-response.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('customer/request-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request SMS OTP for customer registration/login' })
  @ApiOkResponse({ type: RequestOtpResponseDto })
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto);
  }

  @Post('customer/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP and set password' })
  @ApiOkResponse({ type: AuthTokenResponseDto })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Post('customer/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer login via phone and password' })
  @ApiOkResponse({ type: AuthTokenResponseDto })
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
  @ApiOkResponse({ type: AuthTokenResponseDto })
  @ApiUnauthorizedResponse({ description: 'Incorrect credentials.' })
  @ApiForbiddenResponse({
    description:
      'The staff account has been deactivated (US-15.5): ' +
      '`{ "message": "This account has been deactivated. Contact an administrator.", "statusCode": 403 }`',
  })
  async staffLogin(@Body() dto: StaffLoginDto) {
    return this.authService.staffLogin(dto);
  }

  @Post('staff/web-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Staff web-portal login via ERP username + code',
    description:
      'Officers, regional admins and administrators sign in to the web portal using credentials issued by the ERP. The platform validates against ERP, upserts a local Staff row, and returns a JWT.',
  })
  @ApiOkResponse({ type: AuthTokenResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid username or code.' })
  @ApiForbiddenResponse({
    description:
      'The staff account has been deactivated (US-15.5): ' +
      '`{ "message": "This account has been deactivated. Contact an administrator.", "statusCode": 403 }`',
  })
  async staffWebLogin(@Body() dto: StaffWebLoginDto) {
    return this.authService.staffWebLogin(dto);
  }

  @Post('staff/password-reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Staff password reset - request OTP',
    description:
      'Send a 6-digit OTP to the officer/admin via SMS (phone) or email. Always returns success message regardless of whether the account exists, to avoid leaking valid identifiers.',
  })
  @ApiOkResponse({ type: StaffPasswordResetRequestResponseDto })
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
  @ApiOkResponse({ type: AuthTokenResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Refresh token missing, expired, revoked or already used.',
  })
  @ApiForbiddenResponse({
    description:
      'The staff account has been deactivated (US-15.5): ' +
      '`{ "message": "This account has been deactivated. Contact an administrator.", "statusCode": 403 }`',
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
  @ApiOkResponse({ type: MessageResponseDto })
  async logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto.refresh_token);
  }

  @Post('staff/password-reset/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Staff password reset Step 2: verify OTP only, returns short-lived reset_token',
    description:
      'Use after /staff/password-reset/request. Validates the 6-digit code ' +
      'and returns a reset_token (TTL 10 min) that the next step must present. ' +
      'Does NOT set the password — that is Step 3.',
  })
  @ApiOkResponse({ type: StaffPasswordResetVerifyOtpResponseDto })
  async verifyStaffPasswordResetOtp(
    @Body() dto: StaffPasswordResetVerifyOtpDto,
  ) {
    return this.authService.verifyStaffPasswordResetOtp(dto);
  }

  @Post('staff/password-reset/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Staff password reset Step 3: set new password using the reset_token',
    description:
      'Present the reset_token returned by /staff/password-reset/verify-otp ' +
      'plus the new password. Once succeeded, all OTPs for the identifier ' +
      'are wiped so the token cannot be replayed.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  async resetStaffPasswordWithToken(
    @Body() dto: StaffPasswordResetWithTokenDto,
  ) {
    return this.authService.resetStaffPasswordWithToken(dto);
  }

  @Post('staff/password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '[Legacy] Staff password reset - combined OTP + new password (kept for backwards compat)',
    description:
      'Prefer the split verify-otp + reset endpoints for the 3-screen UX. ' +
      'This combined endpoint stays available so existing FE clients keep working.',
    deprecated: true,
  })
  @ApiOkResponse({ type: MessageResponseDto })
  async confirmStaffPasswordReset(@Body() dto: StaffPasswordResetConfirmDto) {
    return this.authService.confirmStaffPasswordReset(dto);
  }
}
