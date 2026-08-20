import { Controller, Get, Query, UseGuards, Res } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiProduces,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Region } from '../../common/region/region.constants';
import { InteractionAuditFilterDto } from './dto/audit.dto';
import {
  PaginatedAuditChatResponseDto,
  PaginatedAuditTicketResponseDto,
} from './dto/audit-response.dto';

/**
 * US-14.3: the audit is strictly read-only — every route here is a GET and no
 * write route is exposed from this view. CC-01: ADMIN only, enforced server
 * side.
 */
@ApiTags('Admin Portal')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@ApiForbiddenResponse({
  description:
    'Caller is not an ADMIN: ' +
    '`{ "message": "You do not have permission to perform this action.", "statusCode": 403 }`',
})
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * B-4.2 — a regional admin sees only their own region, whatever they ask
   * for. An ADMIN keeps whatever region filter they passed (or none).
   */
  private scopeToViewer(
    user: { role: string; region?: Region | null },
    filter: InteractionAuditFilterDto,
  ): InteractionAuditFilterDto {
    if (user.role !== 'REGIONAL_ADMIN') return filter;
    return { ...filter, region: user.region ?? undefined };
  }

  @Get('chats')
  @Roles('ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: 'Audit chat conversations (US-14.2, B-4.2)',
    description:
      'READ-ONLY — the admin can read every thread but cannot reply from ' +
      'here, and no write route is exposed by this view (US-14.3).\n\n' +
      'One row per customer/officer conversation, ordered by most recent ' +
      'message. Takes exactly the same filters and returns the same ' +
      '{ data, meta } envelope as the ticket audit, so the audits page can ' +
      'host it as a second tab reusing the same table, filters and ' +
      'pagination. `keyword` matches the message body; a thread’s ' +
      '`messageCount` counts the matching messages and `messages` carries ' +
      'the 200 most recent of them.\n\n' +
      'B-4.2: filter by `officerId` / `customerId` for an exact match — ' +
      '`officerName` is ambiguous when two officers share a name. ' +
      'REGIONAL_ADMIN may call this and is always scoped to their own ' +
      'region, whatever `region` they pass. An officer with no conversations ' +
      'returns `data: []` with a valid `meta`, never 404.',
  })
  @ApiOkResponse({
    description: 'Paginated list of matching chat threads.',
    type: PaginatedAuditChatResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid date filter or pagination params',
  })
  async searchChats(
    @CurrentUser() user: { role: string; region?: Region | null },
    @Query() query: InteractionAuditFilterDto,
  ) {
    const filter = this.scopeToViewer(user, query);
    return this.auditService.searchChats(filter, query);
  }

  @Get('chats/export.csv')
  @Roles('ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: 'Export chat audit results as CSV (US-14.2)',
    description:
      'Same filters as GET /admin/audit/chats. One row per thread, mirroring ' +
      'the ticket export.',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description:
      'CSV of matching threads (threadId, distributorName, region, ' +
      'officerName, messageCount, lastMessageAt).',
    schema: { type: 'string', format: 'binary' },
  })
  async exportChats(
    @CurrentUser() user: { role: string; region?: Region | null },
    @Query() filter: InteractionAuditFilterDto,
    @Res() res: Response,
  ) {
    const csv = await this.auditService.exportChatsCsv(
      this.scopeToViewer(user, filter),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="viju-chats-audit.csv"',
    );
    res.send(csv);
  }

  @Get('tickets')
  @ApiOperation({
    summary: 'Search all support tickets with full thread',
    description:
      'READ-ONLY (US-14.3). Sortable (US-09.3): `sortBy` accepts ticketId | ' +
      'subject | customerName | region | status | createdAt with `sortOrder` ' +
      '(asc | desc, default desc). Omitting `sortBy` keeps the existing ' +
      'ordering (createdAt descending); an unknown `sortBy` is rejected with ' +
      '400.',
  })
  @ApiOkResponse({
    description:
      'Paginated list of matching support tickets, each with its full reply thread.',
    type: PaginatedAuditTicketResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Unknown sortBy / sortOrder, or invalid date / pagination params',
  })
  async searchTickets(@Query() query: InteractionAuditFilterDto) {
    return this.auditService.searchTickets(query, query);
  }

  @Get('tickets/export.csv')
  @ApiOperation({
    summary: 'Export ticket search results as CSV',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description:
      'CSV file of matching tickets (ticketId, distributorName, region, ' +
      'category, subject, status, createdAt, replyCount).',
    schema: { type: 'string', format: 'binary' },
  })
  async exportTickets(
    @Query() filter: InteractionAuditFilterDto,
    @Res() res: Response,
  ) {
    const csv = await this.auditService.exportTicketsCsv(filter);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="viju-tickets-audit.csv"',
    );
    res.send(csv);
  }
}
