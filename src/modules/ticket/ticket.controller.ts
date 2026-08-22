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
  @ApiOperation({ summary: 'Get all tickets assigned to the current officer' })
  @ApiOkResponse({ type: PaginatedOfficerTicketResponseDto })
  async getOfficerTickets(
    @CurrentUser() user: any,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.ticketService.getAssignedTickets(user.id, pagination);
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
