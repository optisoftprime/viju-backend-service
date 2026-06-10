import { Controller, Get, Query, UseGuards, Res } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiProduces,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { InteractionAuditFilterDto } from './dto/audit.dto';
import {
  PaginatedAuditChatResponseDto,
  PaginatedAuditTicketResponseDto,
} from './dto/audit-response.dto';

@ApiTags('Admin Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('chats')
  @ApiOperation({
    summary: 'Search all customer/officer chat interactions',
    description:
      'READ-ONLY. Admin cannot reply via this endpoint. Filter by customer ' +
      'name, officer name, region, date range, keyword. Returns up to 500 ' +
      'most recent matches.',
  })
  @ApiOkResponse({
    description: 'Paginated list of matching chat messages.',
    type: PaginatedAuditChatResponseDto,
  })
  async searchChats(@Query() query: InteractionAuditFilterDto) {
    return this.auditService.searchChats(query, query);
  }

  @Get('tickets')
  @ApiOperation({
    summary: 'Search all support tickets with full thread',
  })
  @ApiOkResponse({
    description:
      'Paginated list of matching support tickets, each with its full reply thread.',
    type: PaginatedAuditTicketResponseDto,
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
