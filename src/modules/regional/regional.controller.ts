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
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
} from '@nestjs/swagger';
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
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import {
  RegionalDashboardResponseDto,
  PaginatedLoadingRequestsResponseDto,
  PaginatedLoadingQueueResponseDto,
  LoadingRequestDto,
} from './dto/regional-response.dto';

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
    summary: 'Regional Admin dashboard',
    description:
      'Summary cards + pending loading-request queue, scoped to the ' +
      'regional admin’s assigned region. ADMIN can pass ?region= to ' +
      'inspect any region.',
  })
  @ApiOkResponse({
    description: 'Regional summary cards and pending loading-request queue.',
    type: RegionalDashboardResponseDto,
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
  @ApiOkResponse({
    description: 'Paginated loading requests in the region.',
    type: PaginatedLoadingRequestsResponseDto,
  })
  async listRequests(
    @CurrentUser() user: StaffUser,
    @Query() pagination: PaginationQueryDto,
    @Query('status') status: LoadingRequestStatus | 'ALL' = 'ALL',
    @Query('region') queryRegion?: Region,
  ) {
    const region = this.resolveRegion(user, queryRegion);
    return this.regionalService.listRequestsByStatus(
      region,
      status,
      pagination,
    );
  }

  @Patch('loading-requests/:id/assign')
  @Roles('REGIONAL_ADMIN', 'ADMIN')
  @ApiOperation({
    summary:
      'Assign a loading request to a loading / warehouse officer',
  })
  @ApiOkResponse({
    description: 'The updated loading request (now ASSIGNED).',
    type: LoadingRequestDto,
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
    summary: 'Loading / Warehouse Officer queue',
    description:
      'Returns only requests assigned to the current officer in ASSIGNED ' +
      'or LOADING_IN_PROGRESS state.',
  })
  @ApiOkResponse({
    description: 'Paginated queue of requests assigned to the current officer.',
    type: PaginatedLoadingQueueResponseDto,
  })
  async getMyQueue(
    @CurrentUser() user: StaffUser,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.regionalService.getMyLoadingQueue(user.id, pagination);
  }

  @Patch('loading-requests/:id/status')
  @Roles('LOADING_OFFICER', 'WAREHOUSE_OFFICER', 'ADMIN')
  @ApiOperation({
    summary:
      'Loading Officer advances status + uploads waybill',
  })
  @ApiOkResponse({
    description: 'The updated loading request with its new status.',
    type: LoadingRequestDto,
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
