import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TicketService } from './ticket.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateTicketDto, ReplyTicketDto, UpdateTicketStatusDto } from './dto/ticket.dto';

@ApiTags('Support Tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tickets')
export class TicketController {
  constructor(private readonly ticketService: TicketService) {}

  @Post()
  @Roles('CUSTOMER')
  @ApiOperation({ summary: 'Customer creates a new support ticket' })
  async createTicket(@CurrentUser() user: any, @Body() dto: CreateTicketDto) {
    return this.ticketService.createTicket(user.id, dto);
  }

  @Get('customer')
  @Roles('CUSTOMER')
  @ApiOperation({ summary: 'Get all tickets raised by the current customer' })
  async getCustomerTickets(@CurrentUser() user: any) {
    return this.ticketService.getCustomerTickets(user.id);
  }

  @Get('officer')
  @Roles('OFFICER')
  @ApiOperation({ summary: 'Get all tickets assigned to the current officer' })
  async getOfficerTickets(@CurrentUser() user: any) {
    return this.ticketService.getAssignedTickets(user.id);
  }

  @Get(':id')
  @Roles('CUSTOMER', 'OFFICER', 'ADMIN')
  @ApiOperation({ summary: 'Get full ticket thread' })
  async getTicket(@CurrentUser() user: any, @Param('id') id: string) {
    return this.ticketService.getTicket(id, user);
  }

  @Post(':id/replies')
  @Roles('CUSTOMER', 'OFFICER')
  @ApiOperation({ summary: 'Add a reply to a ticket thread' })
  async replyToTicket(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: ReplyTicketDto) {
    return this.ticketService.replyToTicket(id, user.id, dto, user.role);
  }

  @Patch(':id/status')
  @Roles('OFFICER', 'ADMIN')
  @ApiOperation({ summary: 'Update ticket status (e.g. mark as resolved)' })
  async updateStatus(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateTicketStatusDto) {
    return this.ticketService.updateStatus(id, user.id, dto);
  }
}
