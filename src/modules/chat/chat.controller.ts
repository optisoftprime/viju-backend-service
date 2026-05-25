import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
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

  @Get(':otherUserId')
  @Roles('CUSTOMER', 'OFFICER')
  @ApiOperation({ summary: 'Get full message history with a specific user' })
  async getMessages(@CurrentUser() user: any, @Param('otherUserId') otherUserId: string) {
    return this.chatService.getMessages(user, otherUserId);
  }

  @Post(':receiverId')
  @Roles('CUSTOMER', 'OFFICER')
  @ApiOperation({ summary: 'Send a direct message' })
  async sendMessage(
    @CurrentUser() user: any,
    @Param('receiverId') receiverId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(user, receiverId, dto);
  }

  @Get('audit/:customerId')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Admin read-only audit of a customer\'s chat history' })
  async auditCustomerChats(@CurrentUser() user: any, @Param('customerId') customerId: string) {
    return this.chatService.getAudits(user.id, customerId);
  }
}
