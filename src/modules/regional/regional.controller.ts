import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  ForbiddenException,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RegionalService } from './regional.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AssignLoadingOfficerDto,
  UpdateLoadingStatusDto,
} from './dto/regional.dto';
import { Region, LoadingRequestStatus } from '@prisma/client';

interface StaffUser {
  id: string;
  role: string;
  region: Region | null;
}

@ApiTags('Regional Admin Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('regional')
export class RegionalController {
  constructor(private readonly regionalService: RegionalService) {}

  @Get('dashboard')
  @Roles('REGIONAL_ADMIN', 'ADMIN')
  @ApiOperation({
    summary: 'Regional Admin dashboard (PRD F12)',
    description:
      'Summary cards + pending loading-request queue, scoped to the ' +
      'regional admin’s assigned region. ADMIN can pass ?region= to ' +
      'inspect any region.',
  })
  async getDashboard(
    @CurrentUser() user: StaffUser,
    @Query('region') queryRegion?: Region,
  ) {
    const region = this.resolveRegion(user, queryRegion);
    return this.regionalService.getRegionalDashboard(region);
  }

  @Get('loading-requests')
  @Roles('REGIONAL_ADMIN', 'ADMIN')
  @ApiOperation({
    summary: 'All loading requests in the region by status',
    description:
      'Use ?status=PENDING_ASSIGNMENT | ASSIGNED | LOADING_IN_PROGRESS | COMPLETED | ALL',
  })
  async listRequests(
    @CurrentUser() user: StaffUser,
    @Query('status') status: LoadingRequestStatus | 'ALL' = 'ALL',
    @Query('region') queryRegion?: Region,
  ) {
    const region = this.resolveRegion(user, queryRegion);
    return this.regionalService.listRequestsByStatus(region, status);
  }

  @Patch('loading-requests/:id/assign')
  @Roles('REGIONAL_ADMIN', 'ADMIN')
  @ApiOperation({
    summary:
      'Assign a loading request to a loading / warehouse officer (PRD F12 AC5)',
  })
  async assignRequest(
    @CurrentUser() user: StaffUser,
    @Param('id') id: string,
    @Body() dto: AssignLoadingOfficerDto,
  ) {
    const region = this.resolveRegion(user);
    return this.regionalService.assignLoadingRequest(region, user.id, id, dto);
  }

  @Get('my-loading-queue')
  @Roles('LOADING_OFFICER', 'WAREHOUSE_OFFICER', 'ADMIN')
  @ApiOperation({
    summary: 'Loading / Warehouse Officer queue (PRD F13)',
    description:
      'Returns only requests assigned to the current officer in ASSIGNED ' +
      'or LOADING_IN_PROGRESS state.',
  })
  async getMyQueue(@CurrentUser() user: StaffUser) {
    return this.regionalService.getMyLoadingQueue(user.id);
  }

  @Patch('loading-requests/:id/status')
  @Roles('LOADING_OFFICER', 'WAREHOUSE_OFFICER', 'ADMIN')
  @ApiOperation({
    summary:
      'Loading Officer advances status + uploads waybill (PRD F13 AC2-AC3)',
  })
  async updateStatus(
    @CurrentUser() user: StaffUser,
    @Param('id') id: string,
    @Body() dto: UpdateLoadingStatusDto,
  ) {
    return this.regionalService.updateLoadingStatus(user.id, id, dto);
  }

  /**
   * Regional admin / officer scopes are restricted to their assigned
   * region. ADMIN can override via ?region= query param.
   */
  private resolveRegion(user: StaffUser, queryRegion?: Region): Region {
    if (user.role === 'ADMIN') {
      if (!queryRegion)
        throw new ForbiddenException(
          'Admin must specify ?region= for regional endpoints.',
        );
      return queryRegion;
    }
    if (!user.region)
      throw new ForbiddenException(
        'Your account has no region assigned. Contact admin.',
      );
    if (queryRegion && queryRegion !== user.region)
      throw new ForbiddenException(
        'You cannot access data outside your assigned region.',
      );
    return user.region;
  }
}
