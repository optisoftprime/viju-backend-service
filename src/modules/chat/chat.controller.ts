import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Patch,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiParam,
} from '@nestjs/swagger';
import { ChatService } from './chat.service';
import type { ChatActor } from './chat.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SendMessageDto } from './dto/chat.dto';
import {
  MessageDto,
  CustomerThreadMessageDto,
  CustomerSentMessageDto,
  MarkReadResponseDto,
  StaffMarkReadResponseDto,
} from './dto/chat-response.dto';

@ApiTags('Direct Messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ─── Customer-facing endpoints ────────────────
  @Get('me')
  @Roles('CUSTOMER')
  @ApiOperation({
    summary: 'Customer chat thread with the Viju Account Officer',
    description:
      'Returns all messages on this account in chronological order. Each ' +
      'message carries senderLabel: "Viju Account Officer" (either of the ' +
      'two assigned officers) or "You" — individual officer names are not ' +
      'exposed to the customer.',
  })
  @ApiOkResponse({
    type: [CustomerThreadMessageDto],
    description:
      'Chronological list of thread messages with derived senderLabel.',
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
  @ApiCreatedResponse({
    type: CustomerSentMessageDto,
    description: 'The created message with senderLabel "You".',
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
  @ApiOkResponse({
    type: MarkReadResponseDto,
    description: 'Acknowledgement that unread staff messages were marked read.',
  })
  async markRead(@CurrentUser() user: any) {
    return this.chatService.markCustomerThreadRead(user.id);
  }

  // ─── Legacy / officer / admin endpoints ────────────────

  // Declared BEFORE @Get(':otherUserId') and after @Patch('me/read') so the
  // literal 'me' segment still wins over this parameterised path.
  @Patch(':customerId/read')
  @Roles('OFFICER', 'ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: "Mark a distributor's messages on this thread as read by staff",
    description:
      'C-1 — clears the unread state behind the admin dashboard’s ' +
      '`unReadMessage` tile.\n\n' +
      'That tile counts CUSTOMER-authored messages with `readAt: null`. ' +
      'Before this route nothing ever stamped them, so the count could only ' +
      'rise: an admin opened a conversation, read it, and the tile stayed put.\n\n' +
      'Calling `GET /chat/{customerId}` as staff now marks the thread read on ' +
      'its own, so this route is only needed when a client wants to clear the ' +
      'count WITHOUT re-fetching the thread. It is idempotent — a second call ' +
      'returns `markedRead: 0`.\n\n' +
      'Authorisation matches reading the thread: an OFFICER must be assigned ' +
      'to the customer, a REGIONAL_ADMIN is limited to their own region, and ' +
      'an ADMIN reaches every region. A CUSTOMER marks their own thread with ' +
      'PATCH /chat/me/read, which stamps the other direction.',
  })
  @ApiParam({
    name: 'customerId',
    description: 'The distributor whose inbound messages are being read.',
  })
  @ApiOkResponse({
    type: StaffMarkReadResponseDto,
    description: 'How many messages this call actually marked read.',
  })
  @ApiForbiddenResponse({
    description:
      'Officer is not assigned to the customer, or a REGIONAL_ADMIN asked for ' +
      'a customer outside their own region',
  })
  @ApiNotFoundResponse({
    description: 'Customer not found (ADMIN / REGIONAL_ADMIN only)',
  })
  async markStaffRead(
    @CurrentUser() user: ChatActor,
    @Param('customerId') customerId: string,
  ) {
    return this.chatService.markStaffThreadRead(user, customerId);
  }

  @Get(':otherUserId')
  @Roles('CUSTOMER', 'OFFICER', 'ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: 'Get full message history with a specific user',
    description:
      'AD-C1 - the live thread behind the Interaction Audit chat modal, in ' +
      'the same shape for every role: a BARE ARRAY of raw messages, oldest ' +
      'first, never a { data, meta } envelope.\n\n' +
      'What `otherUserId` means per role:\n' +
      '- CUSTOMER: their account officer id. Returns the whole thread on ' +
      'their own account.\n' +
      '- OFFICER: a customer id they currently manage (primary or secondary).\n' +
      '- ADMIN: ANY customer id. No assignment check applies.\n' +
      '- REGIONAL_ADMIN: a customer id in their OWN region; 403 outside it.\n\n' +
      'For staff the whole account thread is returned regardless of which ' +
      'officer each message carries, so a reassignment never hides history.',
  })
  @ApiParam({
    name: 'otherUserId',
    description:
      'The other participant. For OFFICER / ADMIN / REGIONAL_ADMIN this is ' +
      'the CUSTOMER id; for a CUSTOMER it is the officer id.',
  })
  @ApiOkResponse({
    type: [MessageDto],
    description: 'Chronological list of raw messages on this thread.',
  })
  @ApiForbiddenResponse({
    description:
      'Caller is not a participant, or a REGIONAL_ADMIN asked for a customer ' +
      'outside their own region',
  })
  @ApiNotFoundResponse({
    description: 'Customer not found (ADMIN / REGIONAL_ADMIN only)',
  })
  async getMessages(
    @CurrentUser() user: ChatActor,
    @Param('otherUserId') otherUserId: string,
  ) {
    return this.chatService.getMessages(user, otherUserId);
  }

  @Post(':receiverId')
  @Roles('CUSTOMER', 'OFFICER', 'ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: 'Send a direct message (officer / admin endpoint)',
    description:
      'AD-C1 - lets an ADMIN reply to any customer and a REGIONAL_ADMIN to ' +
      'any customer in their own region, exactly as the assigned officer ' +
      'does. `receiverId` is the CUSTOMER id for every staff role.\n\n' +
      'A staff message is stored as `senderType: "STAFF"` with the SENDER OWN ' +
      '`staffId` - an admin reply is attributed to the admin, not to the ' +
      'assigned officer, so the audit trail shows who actually replied. The ' +
      'distributor still sees it under the "Viju Account Officer" label ' +
      '(PRD F6).\n\n' +
      'Returns the SINGLE created message.',
  })
  @ApiParam({
    name: 'receiverId',
    description:
      'The recipient. For OFFICER / ADMIN / REGIONAL_ADMIN this is the ' +
      'CUSTOMER id; for a CUSTOMER it is the officer id.',
  })
  @ApiCreatedResponse({
    type: MessageDto,
    description: 'The created message.',
  })
  @ApiForbiddenResponse({
    description:
      'Caller may not write to this thread, or a REGIONAL_ADMIN wrote outside ' +
      'their own region',
  })
  @ApiNotFoundResponse({
    description: 'Customer not found (ADMIN / REGIONAL_ADMIN only)',
  })
  async sendMessage(
    @CurrentUser() user: ChatActor,
    @Param('receiverId') receiverId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(user, receiverId, dto);
  }

  @Get('audit/:customerId')
  @Roles('ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: "Read-only audit of a customer's chat history",
    description:
      'Read-only companion to GET /chat/{customerId}. ADMIN reaches every ' +
      'customer; REGIONAL_ADMIN only customers in their own region (403 ' +
      'outside it).\n\n' +
      'To READ AND REPLY, use GET and POST /chat/{customerId} instead - both ' +
      'are authorised for ADMIN and REGIONAL_ADMIN.',
  })
  @ApiOkResponse({
    type: [MessageDto],
    description: "Chronological list of all of the customer's raw messages.",
  })
  @ApiForbiddenResponse({
    description: 'REGIONAL_ADMIN asked for a customer outside their own region',
  })
  @ApiNotFoundResponse({ description: 'Customer not found' })
  async auditCustomerChats(
    @CurrentUser() user: ChatActor,
    @Param('customerId') customerId: string,
  ) {
    return this.chatService.getAudits(user, customerId);
  }
}
