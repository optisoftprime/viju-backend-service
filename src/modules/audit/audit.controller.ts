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
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

@ApiTags('Admin Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('chats')
  @ApiOperation({
    summary: 'Search all customer/officer chat interactions (PRD F17)',
    description:
      'READ-ONLY. Admin cannot reply via this endpoint. Filter by customer ' +
      'name, officer name, region, date range, keyword. Returns up to 500 ' +
      'most recent matches.',
  })
  @ApiOkResponse({
    description: 'Paginated list of matching chat messages.',
    type: PaginatedAuditChatResponseDto,
  })
  async searchChats(
    @Query() filter: InteractionAuditFilterDto,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.auditService.searchChats(filter, pagination);
  }

  @Get('tickets')
  @ApiOperation({
    summary: 'Search all support tickets with full thread (PRD F17)',
  })
  @ApiOkResponse({
    description:
      'Paginated list of matching support tickets, each with its full reply thread.',
    type: PaginatedAuditTicketResponseDto,
  })
  async searchTickets(
    @Query() filter: InteractionAuditFilterDto,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.auditService.searchTickets(filter, pagination);
  }

  @Get('tickets/export.csv')
  @ApiOperation({
    summary: 'Export ticket search results as CSV (PRD F17 AC4)',
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
