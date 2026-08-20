import { Controller, Query, Sse, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  RealtimeMessageEvent,
  RealtimeService,
} from '../../infrastructure/realtime/realtime.service';
import {
  ChatMessageEventDto,
  NotificationCreatedEventDto,
  RealtimeStreamQueryDto,
  TicketUpdatedEventDto,
} from './dto/realtime.dto';

interface AuthUser {
  id: string;
  role: string;
}

@ApiTags('Realtime')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Sse('stream')
  @ApiOperation({
    summary: 'Server-sent event stream for chat, tickets and the bell',
    description: [
      'Long-lived `text/event-stream` connection carrying only the frames',
      'addressed to the authenticated caller. Server-to-client ONLY — keep',
      'writing through the existing REST routes; use a frame purely as the',
      'signal to invalidate the matching client cache key.',
      '',
      'Authentication: the same access token as every other route. Send it as',
      '`Authorization: Bearer <access_token>`, or — because the browser',
      '`EventSource` API cannot set headers — as the `token` query param.',
      '',
      'Frames (`event:` name, then a JSON `data:` line):',
      '- `chat.message` — a new message on a thread the caller is part of',
      '- `ticket.updated` — a ticket the caller can see changed status',
      '- `notification.created` — a new bell notification for the caller',
      '',
      'Example frame:',
      '```',
      'event: chat.message',
      'data: {"id":"msg_1","senderId":"cus_9","receiverId":"stf_2",',
      '       "content":"Hello","attachmentUrl":null,',
      '       "createdAt":"2026-08-19T09:12:00.000Z"}',
      '```',
    ].join('\n'),
  })
  @ApiProduces('text/event-stream')
  @ApiExtraModels(
    ChatMessageEventDto,
    TicketUpdatedEventDto,
    NotificationCreatedEventDto,
  )
  @ApiOkResponse({
    description:
      'An open event stream. Each frame carries one of the payloads below ' +
      'in its `data` line.',
    content: {
      'text/event-stream': {
        schema: {
          oneOf: [
            { $ref: getSchemaPath(ChatMessageEventDto) },
            { $ref: getSchemaPath(TicketUpdatedEventDto) },
            { $ref: getSchemaPath(NotificationCreatedEventDto) },
          ],
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid or expired access token',
  })
  stream(
    @CurrentUser() user: AuthUser,
    @Query() query: RealtimeStreamQueryDto,
  ): Observable<RealtimeMessageEvent> {
    return this.realtime.streamFor(
      {
        type: user.role === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF',
        id: user.id,
      },
      query.channels,
    );
  }
}
