import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUserDto } from './dto/users-response.dto';

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
}
