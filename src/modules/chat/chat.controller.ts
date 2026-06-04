import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SendMessageDto } from './dto/chat.dto';

@ApiTags('Direct Messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ─── Customer-facing endpoints (PRD F6) ────────────────
  @Get('me')
  @Roles('CUSTOMER')
  @ApiOperation({
    summary: 'Customer chat thread with the Viju Account Officer (PRD F6)',
    description:
      'Returns all messages on this account in chronological order. Each ' +
      'message carries senderLabel: "Viju Account Officer" (either of the ' +
      'two assigned officers) or "You" — individual officer names are not ' +
      'exposed to the customer per PRD F6 AC1.',
  })
  async getMyThread(@CurrentUser() user: any) {
    return this.chatService.getCustomerThread(user.id);
  }

  @Post('me')
  @Roles('CUSTOMER')
  @ApiOperation({
    summary: 'Customer sends a message to their account officer team',
    description:
      'Message is routed to the primary officer; both primary and ' +
      'secondary officers receive notifications.',
  })
  async sendFromCustomer(
    @CurrentUser() user: any,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendFromCustomer(user.id, dto);
  }

  @Patch('me/read')
  @Roles('CUSTOMER')
  @ApiOperation({ summary: 'Mark all staff messages on this thread as read' })
  async markRead(@CurrentUser() user: any) {
    return this.chatService.markCustomerThreadRead(user.id);
  }

  // ─── Legacy / officer endpoints ────────────────────────
  @Get(':otherUserId')
  @Roles('CUSTOMER', 'OFFICER')
  @ApiOperation({
    summary: 'Get full message history with a specific user (legacy)',
  })
  async getMessages(
    @CurrentUser() user: any,
    @Param('otherUserId') otherUserId: string,
  ) {
    return this.chatService.getMessages(user, otherUserId);
  }

  @Post(':receiverId')
  @Roles('CUSTOMER', 'OFFICER')
  @ApiOperation({ summary: 'Send a direct message (officer endpoint)' })
  async sendMessage(
    @CurrentUser() user: any,
    @Param('receiverId') receiverId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(user, receiverId, dto);
  }

  @Get('audit/:customerId')
  @Roles('ADMIN')
  @ApiOperation({
    summary: "Admin read-only audit of a customer's chat history",
  })
  async auditCustomerChats(
    @CurrentUser() user: any,
    @Param('customerId') customerId: string,
  ) {
    return this.chatService.getAudits(user.id, customerId);
  }
}
