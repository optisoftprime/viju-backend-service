import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserDto, PasswordChangedDto } from './dto/users-response.dto';
import { ChangeMyPasswordDto, UpdateMyPhotoDto } from './dto/users.dto';

interface AuthUser {
  id: string;
  role: string;
}

@ApiTags('Authentication')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({
    summary: 'The signed-in user, including the region their data is scoped to',
    description:
      'Works for any authenticated principal — customer or staff. The web ' +
      'portal reads `region` from here (RA-03) instead of assuming one, and ' +
      '`role` to decide which navigation to render. Server-side gating still ' +
      'happens on every request regardless of what the client renders (CC-01).',
  })
  @ApiOkResponse({ type: CurrentUserDto })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid or expired access token',
  })
  async me(@CurrentUser() user: AuthUser) {
    return this.usersService.getMe(user);
  }

  @Patch('profile/photo')
  @ApiOperation({
    summary: 'Set or clear your own profile picture',
    description:
      'PR-1 — acts on the account on the TOKEN. There is no id in the path, ' +
      'so one user cannot set another’s picture. Open to every signed-in ' +
      'role: staff and customers alike.\n\n' +
      'Two steps by design — upload through ' +
      '`POST /uploads?folder=profile-photos` first and send the URL it ' +
      'returns. That reuses the upload route’s storage handling and its size ' +
      'and type rules (including the PR-3 magic-number check) rather than ' +
      'growing a second multipart endpoint.\n\n' +
      'The URL must be one this service produced. An arbitrary URL is refused ' +
      'with `400 INVALID_UPLOAD_URL`: this field is rendered in an `<img>` ' +
      'for every viewer of that user, so accepting any host would make it a ' +
      'tracking beacon.\n\n' +
      'Send `null` (or `""`) to clear the picture.\n\n' +
      'Responds with the REFRESHED PROFILE, identical in shape to ' +
      'GET /users/me, so the navbar and sidebar avatar update from this one ' +
      'response without a second read.',
  })
  @ApiOkResponse({ type: CurrentUserDto })
  @ApiBadRequestResponse({
    description:
      '`INVALID_UPLOAD_URL` — not an https URL on one of this deployment’s ' +
      'own upload hosts',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid or expired access token',
  })
  async updatePhoto(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateMyPhotoDto,
  ) {
    return this.usersService.updateMyPhoto(user, dto.profilePhotoUrl);
  }

  @Patch('profile/password')
  @ApiOperation({
    summary: 'Change your own password, proving you know the current one',
    description:
      'PR-2 — acts on the account on the TOKEN. Open to every signed-in role.\n\n' +
      'Deliberately NOT the forgot-password flow: ' +
      '`/auth/staff/password-reset/*` proves control of an inbox, which is a ' +
      'different question from proving knowledge of the password. Requiring ' +
      'the current one is what makes this safe to expose on a session that ' +
      'may have been left open.\n\n' +
      '`currentPassword` is compared against the stored hash BEFORE anything ' +
      'is written. `confirmNewPassword` is not accepted — its only job is ' +
      'catching a typo in the form.\n\n' +
      'SESSIONS ARE NOT INVALIDATED. Existing refresh tokens keep working, ' +
      'here and on other devices, so nobody is signed out by this call. Say ' +
      'nothing about other devices in the form.',
  })
  @ApiOkResponse({ type: PasswordChangedDto })
  @ApiBadRequestResponse({
    description:
      '`INVALID_CURRENT_PASSWORD` (does not match), `PASSWORD_REUSED` (same ' +
      'as the current one), `NO_PASSWORD_SET` (ERP-mirrored account with no ' +
      'local password), or a `newPassword` outside 8–72 characters. Each ' +
      'carries `field` so it can be rendered against the right input.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid or expired access token',
  })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangeMyPasswordDto,
  ) {
    return this.usersService.changeMyPassword(
      user,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
