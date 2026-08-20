import { Module } from '@nestjs/common';
import { TicketController } from './ticket.controller';
import { TicketService } from './ticket.service';
import { NotificationModule } from '../../infrastructure/notification/notification.module';
import { RealtimeModule } from '../../infrastructure/realtime/realtime.module';

@Module({
  imports: [NotificationModule, RealtimeModule],
  controllers: [TicketController],
  providers: [TicketService],
})
export class TicketModule {}
