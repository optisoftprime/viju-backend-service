import { Module } from '@nestjs/common';
import { TicketController } from './ticket.controller';
import { TicketService } from './ticket.service';
import { NotificationModule } from '../../infrastructure/notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [TicketController],
  providers: [TicketService],
})
export class TicketModule {}
