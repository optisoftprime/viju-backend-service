import {
  Controller,
  Get,
  Post,
  Patch,
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
  ApiNotFoundResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { TicketService } from './ticket.service';
import type { TicketActor } from './ticket.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateTicketDto,
  ReplyTicketDto,
  UpdateTicketStatusDto,
  OfficerTicketsFilterDto,
} from './dto/ticket.dto';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import {
  TicketResponseDto,
  TicketThreadResponseDto,
  TicketThreadWithReplyResponseDto,
  PaginatedTicketResponseDto,
  PaginatedOfficerTicketResponseDto,
} from './dto/ticket-response.dto';

@ApiTags('Support Tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tickets')
export class TicketController {
  constructor(private readonly ticketService: TicketService) {}

  @Post()
  @Roles('CUSTOMER')
  @ApiOperation({ summary: 'Customer creates a new support ticket' })
  @ApiCreatedResponse({ type: TicketResponseDto })
  async createTicket(@CurrentUser() user: any, @Body() dto: CreateTicketDto) {
    return this.ticketService.createTicket(user.id, dto);
  }

  @Get('customer')
  @Roles('CUSTOMER')
  @ApiOperation({ summary: 'Get all tickets raised by the current customer' })
  @ApiOkResponse({ type: PaginatedTicketResponseDto })
  async getCustomerTickets(
    @CurrentUser() user: any,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.ticketService.getCustomerTickets(user.id, pagination);
  }

  @Get('officer')
  @Roles('OFFICER')
  @ApiOperation({
    summary: 'Get all tickets assigned to the current officer',
    description:
      'Every ticket raised by a distributor this officer manages, primary OR ' +
      'secondary, newest first.\n\n' +
      'AO-T1 - two filters, both applied in SQL so `meta.total` counts the ' +
      'FILTERED set:\n' +
      '- `customerId` narrows to one distributor, for the Tickets tab inside ' +
      'a detail view. A malformed id, or one that is not assigned to the ' +
      'caller, is rejected with 400.\n' +
      '- `status` narrows to one or more ticket statuses, repeatable or ' +
      'comma-separated - identical semantics to the filter on ' +
      'GET /admin/audit/tickets.\n\n' +
      'Each row carries `repliesCount` and a `customer` summary ' +
      '(id, erpId, name, phone, email).',
  })
  @ApiOkResponse({ type: PaginatedOfficerTicketResponseDto })
  @ApiBadRequestResponse({
    description:
      'Malformed `customerId`, a `customerId` outside the caller\u2019s ' +
      'portfolio, an unknown `status`, or invalid pagination params. An ' +
      'unknown status answers `{ "message": "status must be one of: OPEN, ' +
      'IN_PROGRESS, AWAITING_CUSTOMER, RESOLVED", "code": "VALIDATION_ERROR" }`.',
  })
  async getOfficerTickets(
    @CurrentUser() user: any,
    @Query() query: OfficerTicketsFilterDto,
  ) {
    return this.ticketService.getAssignedTickets(user.id, query);
  }

  @Get(':id')
  @Roles('CUSTOMER', 'OFFICER', 'ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: 'Get full ticket thread',
    description:
      'AD-T1 - the Interaction Audit opens ticket threads through this route, ' +
      'so it is authorised for staff who are not the assigned officer.\n\n' +
      '- CUSTOMER: their own ticket only.\n' +
      '- OFFICER: a customer they currently manage (primary or secondary).\n' +
      '- ADMIN: EVERY ticket. No `assignedOfficerId` check applies, because ' +
      'an admin is never the assigned officer.\n' +
      '- REGIONAL_ADMIN: every ticket whose customer is in their own region, ' +
      'taken from the token; 403 outside it - the same rule already applied ' +
      'to GET /admin/audit/chats.\n\n' +
      'The response shape is identical for every role, so the same components ' +
      'render it.',
  })
  @ApiOkResponse({ type: TicketThreadResponseDto })
  @ApiForbiddenResponse({
    description:
      'Caller is not on this ticket, or a REGIONAL_ADMIN asked for a ticket ' +
      'outside their own region',
  })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  async getTicket(@CurrentUser() user: TicketActor, @Param('id') id: string) {
    return this.ticketService.getTicket(id, user);
  }

  @Post(':id/replies')
  @Roles('CUSTOMER', 'OFFICER', 'ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: 'Add a reply to a ticket thread',
    description:
      'AD-T1 - same authorisation as GET /tickets/{id}: an ADMIN may reply to ' +
      'any ticket and a REGIONAL_ADMIN to any ticket in their own region.\n\n' +
      'Returns THE WHOLE THREAD (the GET /tickets/{id} shape) with the new ' +
      'reply already appended, so a modal can re-render straight from the ' +
      'response without refetching. The created reply is also echoed on ' +
      '`reply`.\n\n' +
      'A staff reply carries the AUTHORS OWN `staffId` - including an admin ' +
      'replying from the audit - so the trail records who actually answered ' +
      'rather than crediting the assigned officer.',
  })
  @ApiCreatedResponse({ type: TicketThreadWithReplyResponseDto })
  @ApiForbiddenResponse({
    description:
      'Caller is not on this ticket, or a REGIONAL_ADMIN replied outside ' +
      'their own region',
  })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  async replyToTicket(
    @CurrentUser() user: TicketActor,
    @Param('id') id: string,
    @Body() dto: ReplyTicketDto,
  ) {
    return this.ticketService.replyToTicket(id, user, dto);
  }

  @Patch(':id/status')
  @Roles('OFFICER', 'ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: 'Update ticket status (e.g. mark as resolved)',
    description:
      'AD-T1 - authorised with the CALLERS own role. An ADMIN may change the ' +
      'status of any ticket, a REGIONAL_ADMIN of any ticket in their own ' +
      'region, and an OFFICER only on a customer they manage. Returns the ' +
      'updated ticket, which carries `id`, `status` and `updatedAt`.',
  })
  @ApiOkResponse({ type: TicketResponseDto })
  @ApiForbiddenResponse({
    description:
      'Officer is not on this ticket, or a REGIONAL_ADMIN acted outside their ' +
      'own region',
  })
  @ApiNotFoundResponse({ description: 'Ticket not found' })
  async updateStatus(
    @CurrentUser() user: TicketActor,
    @Param('id') id: string,
    @Body() dto: UpdateTicketStatusDto,
  ) {
    return this.ticketService.updateStatus(id, user, dto);
  }
}
