import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { NotificationModule } from '../../infrastructure/notification/notification.module';
import { RealtimeModule } from '../../infrastructure/realtime/realtime.module';

@Module({
  imports: [NotificationModule, RealtimeModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
