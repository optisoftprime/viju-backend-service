import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { LoadingService } from './loading.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  LoadingQueueQueryDto,
  RecordWaybillDto,
  UpdateLoadingDescriptionDto,
  UpdateQueueStatusDto,
} from './dto/loading.dto';
import {
  LoadingQueueDetailDto,
  LoadingStatusUpdatedDto,
  PaginatedLoadingQueueResponseDto,
  RecordedWaybillDto,
} from './dto/loading-response.dto';

interface StaffUser {
  id: string;
  role: string;
}

/**
 * The loading officer's own queue (PRD F13).
 *
 * CC-01: /loading/* is refused for every other role, server-side. Inside the
 * module, work is scoped to the officer on the token — no route accepts an
 * officerId, so one loading officer can never read or advance another's work.
 */
@ApiTags('Loading Officer Portal')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@ApiForbiddenResponse({
  description:
    'Caller is not a loading / warehouse officer: ' +
    '`{ "message": "You do not have permission to perform this action.", "statusCode": 403 }`',
})
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('LOADING_OFFICER', 'WAREHOUSE_OFFICER')
@Controller('loading')
export class LoadingController {
  constructor(private readonly loadingService: LoadingService) {}

  @Get('queue')
  @ApiOperation({
    summary: 'My loading queue',
    description:
      'LO-02 — the assignments belonging to the signed-in loading officer, ' +
      'derived from the token. Returns ASSIGNED, IN_PROGRESS and COMPLETED ' +
      'loads so the FE can group them by state; pass `status` to narrow to ' +
      'one. Ordered by requested loading date, soonest first.',
  })
  @ApiOkResponse({ type: PaginatedLoadingQueueResponseDto })
  @ApiBadRequestResponse({
    description: 'Unknown status filter or invalid pagination params',
  })
  async getMyQueue(
    @CurrentUser() user: StaffUser,
    @Query() query: LoadingQueueQueryDto,
  ) {
    return this.loadingService.getMyQueue(user.id, query);
  }

  @Get('queue/:id')
  @ApiOperation({
    summary: 'Assignment detail',
    description:
      'LO-03 — the detail panel for one queue item: order, distributor, ' +
      'region, submitted date, truck, driver, loading date, quantity and ' +
      'current status. Returns 403 when the assignment belongs to another ' +
      'officer.',
  })
  @ApiParam({ name: 'id', description: 'Loading request id' })
  @ApiOkResponse({ type: LoadingQueueDetailDto })
  @ApiNotFoundResponse({ description: 'Loading request not found' })
  @ApiForbiddenResponse({
    description:
      'The assignment belongs to another officer: ' +
      '`{ "message": "This loading request is not assigned to you.", "statusCode": 403 }`',
  })
  async getQueueItem(@CurrentUser() user: StaffUser, @Param('id') id: string) {
    return this.loadingService.getQueueItem(user.id, id);
  }

  @Patch('queue/:id/status')
  @ApiOperation({
    summary: 'Advance a load / mark it complete / cancel it',
    description:
      'LO-04 — ASSIGNED → IN_PROGRESS → COMPLETED. Any other move, including ' +
      'reopening a completed load, is refused with 409 and a machine-readable ' +
      '`code` rather than silently accepted. The distributor is notified on ' +
      'each change, which is the same feed the regional dashboard reads.\n\n' +
      'L-1 — send `{ "status": "CANCELLED" }` (optionally with `reason`) to ' +
      'call the load off. Legal from PENDING, ASSIGNED and IN_PROGRESS; a ' +
      'COMPLETED load is final and answers 409. `cancelledAt` and ' +
      '`cancelReason` are stamped and returned.',
  })
  @ApiParam({ name: 'id', description: 'Loading request id' })
  @ApiOkResponse({ type: LoadingStatusUpdatedDto })
  @ApiNotFoundResponse({ description: 'Loading request not found' })
  @ApiForbiddenResponse({
    description: 'The assignment belongs to another officer',
  })
  @ApiConflictResponse({
    description:
      'Illegal transition: `{ "message": "A completed load cannot be ' +
      'reopened.", "code": "INVALID_STATUS_TRANSITION", "statusCode": 409 }`',
  })
  async updateStatus(
    @CurrentUser() user: StaffUser,
    @Param('id') id: string,
    @Body() dto: UpdateQueueStatusDto,
  ) {
    return this.loadingService.updateStatus(user.id, id, dto);
  }

  @Patch('queue/:id/description')
  @ApiOperation({
    summary: 'Set or clear the loading note on a load',
    description:
      'L-2 — the DESCRIPTION column on the loading screen, e.g. "customer ' +
      'loading 800 cartons on 26/08/2026, remaining a balance of 200 ' +
      'cartons".\n\n' +
      'Its own route, not a field on the status route: the note is written ' +
      'and corrected independently of the status, so saving one never moves ' +
      'the other.\n\n' +
      'Writable by the ASSIGNED loading officer only. Send `""` to clear the ' +
      'note — it reads back as `null` afterwards. Max 500 characters.\n\n' +
      'Responds with the full assignment detail so the screen re-renders from ' +
      'one body.',
  })
  @ApiParam({ name: 'id', description: 'Loading request id' })
  @ApiOkResponse({ type: LoadingQueueDetailDto })
  @ApiNotFoundResponse({ description: 'Loading request not found' })
  @ApiForbiddenResponse({
    description: 'The assignment belongs to another officer',
  })
  async updateDescription(
    @CurrentUser() user: StaffUser,
    @Param('id') id: string,
    @Body() dto: UpdateLoadingDescriptionDto,
  ) {
    return this.loadingService.updateDescription(user.id, id, dto);
  }

  @Post('queue/:id/waybill')
  @ApiOperation({
    summary: 'Record the completed load (waybill capture)',
    description:
      'LO-05 — records truck, driver, quantity and an optional ' +
      'proof-of-loading image, and completes the load. Upload the image ' +
      'first with POST /uploads (folder=waybill-documents) and pass the URL ' +
      'it returns as `attachmentUrl`.\n\n' +
      'The record written here is the same row GET ' +
      '/officers/customers/{id}/waybills reads back, so the captured values ' +
      'show up on the officer portal immediately.',
  })
  @ApiParam({ name: 'id', description: 'Loading request id' })
  @ApiCreatedResponse({ type: RecordedWaybillDto })
  @ApiBadRequestResponse({ description: 'Missing or invalid waybill fields' })
  @ApiNotFoundResponse({ description: 'Loading request not found' })
  @ApiForbiddenResponse({
    description: 'The assignment belongs to another officer',
  })
  @ApiConflictResponse({
    description:
      'The load is already completed: ' +
      '`{ "message": "A completed load cannot be reopened.", ' +
      '"code": "INVALID_STATUS_TRANSITION", "statusCode": 409 }`',
  })
  async recordWaybill(
    @CurrentUser() user: StaffUser,
    @Param('id') id: string,
    @Body() dto: RecordWaybillDto,
  ) {
    return this.loadingService.recordWaybill(user.id, id, dto);
  }
}
