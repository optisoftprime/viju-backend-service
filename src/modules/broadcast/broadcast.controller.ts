import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { BroadcastService } from './broadcast.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  SendRegionalBroadcastDto,
  SendIndividualBroadcastDto,
  BroadcastHistoryFilterDto,
} from './dto/broadcast.dto';
import {
  BroadcastDto,
  BroadcastDetailDto,
  PaginatedBroadcastHistoryResponseDto,
} from './dto/broadcast-response.dto';
import {
  RegionScopedActor,
  isRegionalAdmin,
  requireOwnRegion,
} from '../../common/region/regional-scope';
import { Region } from '../../common/region/region.constants';

@ApiTags('Admin Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/broadcasts')
export class BroadcastController {
  constructor(private readonly broadcastService: BroadcastService) {}

  /**
   * RB-1..RB-3 - the region a REGIONAL_ADMIN is confined to, or `undefined`
   * for an ADMIN, who is organisation-wide.
   *
   * Read from the token, never from the request. An unconfigured regional
   * admin (no region on their staff record) is refused with `REGION_NOT_SET`
   * rather than being handed every region.
   */
  private scopeOf(user: RegionScopedActor): Region | undefined {
    return isRegionalAdmin(user) ? requireOwnRegion(user) : undefined;
  }

  @Post('regional')
  @Roles('ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: 'Send a regional broadcast',
    description:
      'RB-2 - a REGIONAL_ADMIN may send to their OWN region only. Naming any ' +
      'other region, or more than one, is refused with ' +
      '`403 REGION_NOT_ALLOWED` rather than silently narrowed: an admin who ' +
      'believes they reached three regions and reached one has been misled.\n\n' +
      'An ADMIN is unchanged and may target any combination of regions.',
  })
  @ApiCreatedResponse({
    description: 'The created regional broadcast record.',
    type: BroadcastDto,
  })
  @ApiForbiddenResponse({
    description:
      '`REGION_NOT_ALLOWED` (a regional admin named another region) or ' +
      '`REGION_NOT_SET` (no region on their account)',
  })
  async sendRegional(
    @CurrentUser() user: RegionScopedActor & { id: string },
    @Body() dto: SendRegionalBroadcastDto,
  ) {
    return this.broadcastService.sendRegional(user.id, dto, this.scopeOf(user));
  }

  @Post('individual')
  @Roles('ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: 'Send an individual broadcast — with optional delivery allowance',
    description:
      'If deliveryAllowance > 0, the amount is credited to the wallet ' +
      'IMMEDIATELY (not next ERP sync). A Payment row with reference ' +
      '"Delivery Allowance" is created in the same transaction.\n\n' +
      'RB-3 - a REGIONAL_ADMIN may message distributors in their OWN region ' +
      'only, on BOTH the single `customerId` and the `customerIds[]` batch ' +
      'form. If ANY recipient falls outside their region the WHOLE CALL is ' +
      'refused with `403 REGION_NOT_ALLOWED` and NOTHING is sent - not a ' +
      'partial `failed[]` half, because a broadcast is not idempotent and a ' +
      'retried half-send would double-message everyone who did receive it.',
  })
  @ApiCreatedResponse({
    description: 'The created individual broadcast record.',
    type: BroadcastDto,
  })
  @ApiForbiddenResponse({
    description:
      '`REGION_NOT_ALLOWED` (a recipient outside the caller’s region — ' +
      'nothing was sent) or `REGION_NOT_SET`',
  })
  async sendIndividual(
    @CurrentUser() user: RegionScopedActor & { id: string },
    @Body() dto: SendIndividualBroadcastDto,
  ) {
    return this.broadcastService.sendIndividual(
      user.id,
      dto,
      this.scopeOf(user),
    );
  }

  @Get('history')
  @Roles('ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: 'Broadcast history with filters',
    description:
      'RB-1 - a REGIONAL_ADMIN sees only their own region, scoped ' +
      'SERVER-SIDE. The region comes from the token and OVERRIDES anything ' +
      'sent, matching the audit routes (RA-T2), so the client never has to ' +
      'know whether the parameter is honoured or refused - it simply omits ' +
      'it.\n\n' +
      'In scope means: a REGIONAL broadcast whose `targetRegions` contains ' +
      'their region, or an INDIVIDUAL broadcast to a customer in it.\n\n' +
      'The `search` filter applies WITHIN that scope and can never reach ' +
      'across it - an out-of-region broadcast does not appear even when its ' +
      'message matches. `meta.total` counts the scoped set.',
  })
  @ApiOkResponse({
    description: 'Paginated broadcast history (newest first).',
    type: PaginatedBroadcastHistoryResponseDto,
  })
  @ApiForbiddenResponse({
    description: '`REGION_NOT_SET` — no region on the caller’s account',
  })
  async history(
    @CurrentUser() user: RegionScopedActor,
    @Query() query: BroadcastHistoryFilterDto,
  ) {
    return this.broadcastService.listHistory(query, query, this.scopeOf(user));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Broadcast detail' })
  @ApiOkResponse({
    description:
      'Full broadcast detail incl. sender, target customer and allowance payment.',
    type: BroadcastDetailDto,
  })
  async detail(@Param('id') id: string) {
    return this.broadcastService.getDetail(id);
  }
}
