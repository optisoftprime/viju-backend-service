import { ApiProperty } from '@nestjs/swagger';
import { Region, REGION_VALUES } from '../../../common/region/region.constants';

const ROLE_VALUES = [
  'CUSTOMER',
  'ADMIN',
  'OFFICER',
  'REGIONAL_ADMIN',
  'LOADING_OFFICER',
  'WAREHOUSE_OFFICER',
] as const;
type AuthRole = (typeof ROLE_VALUES)[number];

// ─── Authenticated user summary (embedded in token responses) ──────────────

export class AuthUserDto {
  @ApiProperty({ example: '3f8a1c2e-9b4d-4e7a-8c1f-1d2e3a4b5c6d' })
  id: string;

  @ApiProperty({ example: 'Jane Distributor' })
  name: string;

  @ApiProperty({
    enum: ROLE_VALUES,
    example: 'CUSTOMER',
    description:
      "Always 'CUSTOMER' for customer logins; the StaffRole value for staff logins.",
  })
  role: AuthRole;

  @ApiProperty({
    example: 'c.eze@viju.com',
    nullable: true,
    description: "The user's email. Null for customers who have none on file.",
  })
  email: string | null;

  @ApiProperty({
    enum: REGION_VALUES,
    nullable: true,
    example: 'WESTERN',
    description:
      "The user's region (RA-03). Always set for customers; null for org-wide " +
      'ADMIN and for staff with no ERP posting. Every region-scoped endpoint ' +
      'filters by this value server-side — a client-supplied region query ' +
      'param can never widen it.',
  })
  region: Region | null;
}

// ─── Token pair response ───────────────────────────────────────────────────
// Returned by: customer/verify-otp, customer/login, staff/login,
// staff/web-login, refresh

export class AuthTokenResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzZjhhIn0.abc',
    description: 'Short-lived JWT access token.',
  })
  access_token: string;

  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI5YjRkIn0.xyz',
    description: 'Single-use rotating refresh token.',
  })
  refresh_token: string;

  @ApiProperty({
    example: 3600,
    description: 'Access token lifetime in seconds.',
  })
  expires_in: number;

  @ApiProperty({
    example: 2592000,
    description: 'Refresh token lifetime in seconds.',
  })
  refresh_expires_in: number;

  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;
}

// ─── OTP request acknowledgement ───────────────────────────────────────────
// Returned by: customer/request-otp
// NOTE: devOtp / devNote are ONLY present when NODE_ENV !== 'production'.

export class RequestOtpResponseDto {
  @ApiProperty({ example: 'OTP sent successfully' })
  message: string;

  @ApiProperty({
    required: false,
    nullable: true,
    example: '123456',
    description:
      'Dev-only: the OTP code. Present only when NODE_ENV !== "production".',
  })
  devOtp?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    example:
      'OTP is included in this response because NODE_ENV !== "production". Never enable dev mode in prod.',
    description: 'Dev-only note explaining why the OTP is exposed.',
  })
  devNote?: string;
}

// ─── Staff password-reset OTP request acknowledgement ──────────────────────
// Returned by: staff/password-reset/request
// NOTE: devOtp is ONLY present when NODE_ENV !== 'production'.

export class StaffPasswordResetRequestResponseDto {
  @ApiProperty({ example: 'If the account exists, an OTP has been sent.' })
  message: string;

  @ApiProperty({
    required: false,
    nullable: true,
    example: '123456',
    description:
      'Dev-only: the OTP code. Present only when NODE_ENV !== "production".',
  })
  devOtp?: string;
}

// ─── Staff password-reset OTP verification ─────────────────────────────────
// Returned by: staff/password-reset/verify-otp

export class StaffPasswordResetVerifyOtpResponseDto {
  @ApiProperty({ example: 'OTP verified. Proceed to set a new password.' })
  message: string;

  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoiUEFTUyJ9.tok',
    description:
      'Short-lived JWT (TTL 10 min) to present at staff/password-reset/reset.',
  })
  reset_token: string;

  @ApiProperty({
    example: 600,
    description: 'Reset token lifetime in seconds.',
  })
  expires_in: number;
}
