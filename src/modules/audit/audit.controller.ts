import {
  Controller,
  Get,
  Query,
  UseGuards,
  Res,
  ForbiddenException,
  HttpStatus,
} from '@nestjs/common';
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
 * write route is exposed from this view. CC-01: authorisation is enforced
 * server side.
 *
 * The class default is ADMIN. Both audits (chats and tickets, list and CSV)
 * additionally admit REGIONAL_ADMIN and are then ALWAYS scoped to that
 * admin's own region by `scopeToViewer` — whatever `region` the client sends
 * (B-4.2, RA-T2). No other role reaches this controller.
 */
@ApiTags('Admin Portal')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@ApiForbiddenResponse({
  description:
    'Caller is neither an ADMIN nor a REGIONAL_ADMIN: ' +
    '`{ "message": "You do not have permission to perform this action.", "statusCode": 403 }`',
})
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * B-4.2 / RA-T2 — a regional admin sees only their own region, whatever
   * they ask for. An ADMIN keeps whatever region filter they passed (or none).
   *
   * A REGIONAL_ADMIN whose record carries NO region cannot be scoped, and
   * falling through with `region: undefined` would hand them every region at
   * once. That is a misconfigured account, so it is refused rather than
   * widened — properly provisioned regional admins always carry a region.
   */
  private scopeToViewer(
    user: { role: string; region?: Region | null },
    filter: InteractionAuditFilterDto,
  ): InteractionAuditFilterDto {
    if (user.role !== 'REGIONAL_ADMIN') return filter;
    if (!user.region) {
      throw new ForbiddenException({
        message: 'No region is set on your account. Contact an administrator.',
        code: 'REGION_NOT_SET',
        statusCode: HttpStatus.FORBIDDEN,
      });
    }
    return { ...filter, region: user.region };
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
    summary: 'Export chat audit results as CSV (US-14.2, AD-X1)',
    description:
      'Accepts exactly the same filters as GET /admin/audit/chats - `region`, ' +
      '`customerName`, `officerName`, `keyword`, `startDate`, `endDate`, ' +
      '`officerId`, `customerId` - so the export matches whatever the ' +
      'operator is looking at. One row per conversation, matching the Chat ' +
      'tab.\n\n' +
      'The body is CSV, not a JSON envelope: read it as a Blob. Served as ' +
      '`text/csv; charset=utf-8` with ' +
      '`Content-Disposition: attachment; filename="viju-audit-chats.csv"`. ' +
      'No matches returns the header row alone with a 200, never a 404.\n\n' +
      'REGIONAL_ADMIN is always scoped to their own region, whatever `region` ' +
      'they pass.',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description:
      'CSV of matching conversations. Header row: ' +
      '`Customer,Customer Code,Account Officer,Region,Messages,Last Message`.',
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
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="viju-audit-chats.csv"',
    );
    res.send(csv);
  }

  @Get('tickets')
  @Roles('ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: 'Search all support tickets with full thread (RA-T1, RA-T2)',
    description:
      'READ-ONLY (US-14.3). Sortable (US-09.3): `sortBy` accepts ticketId | ' +
      'subject | customerName | region | status | createdAt with `sortOrder` ' +
      '(asc | desc, default desc). Omitting `sortBy` keeps the existing ' +
      'ordering (createdAt descending); an unknown `sortBy` is rejected with ' +
      '400.\n\n' +
      'RA-T1: `status` narrows the result set to one or more ticket statuses ' +
      '- repeatable (`?status=OPEN&status=IN_PROGRESS`) or comma-separated ' +
      '(`?status=OPEN,IN_PROGRESS,AWAITING_CUSTOMER`) - and `meta.total` ' +
      'counts the FILTERED set, so the Open Tickets page asks for everything ' +
      'unresolved in one request and its pager agrees with what is on ' +
      'screen. An unknown value is rejected with 400 and ' +
      '`code: "VALIDATION_ERROR"`.\n\n' +
      'RA-T2: REGIONAL_ADMIN may call this and is ALWAYS scoped to their own ' +
      'region, taken from the token, whatever `region` they pass - the same ' +
      'rule as GET /admin/audit/chats. An empty region returns `data: []` ' +
      'with a valid `meta`, never a 404.',
  })
  @ApiOkResponse({
    description:
      'Paginated list of matching support tickets, each with its full reply thread.',
    type: PaginatedAuditTicketResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Unknown status / sortBy / sortOrder, or invalid date / pagination ' +
      'params. An unknown `status` answers ' +
      '`{ "message": "status must be one of: OPEN, IN_PROGRESS, ' +
      'AWAITING_CUSTOMER, RESOLVED", "code": "VALIDATION_ERROR" }`.',
  })
  async searchTickets(
    @CurrentUser() user: { role: string; region?: Region | null },
    @Query() query: InteractionAuditFilterDto,
  ) {
    const filter = this.scopeToViewer(user, query);
    return this.auditService.searchTickets(filter, query);
  }

  @Get('tickets/export.csv')
  @Roles('ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: 'Export ticket search results as CSV',
    description:
      'Same filters as GET /admin/audit/tickets, including the RA-T1 ' +
      '`status` filter. REGIONAL_ADMIN is always scoped to their own region.',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description:
      'CSV file of matching tickets (ticketId, distributorName, region, ' +
      'category, subject, status, createdAt, replyCount).',
    schema: { type: 'string', format: 'binary' },
  })
  async exportTickets(
    @CurrentUser() user: { role: string; region?: Region | null },
    @Query() filter: InteractionAuditFilterDto,
    @Res() res: Response,
  ) {
    const csv = await this.auditService.exportTicketsCsv(
      this.scopeToViewer(user, filter),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="viju-tickets-audit.csv"',
    );
    res.send(csv);
  }
}
