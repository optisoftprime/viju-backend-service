import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './infrastructure/database/database.module';
import { ErpRawModule } from './infrastructure/erp-raw/erp-raw.module';
import { AuthModule } from './modules/auth/auth.module';
import { CustomerModule } from './modules/customer/customer.module';
import { OfficerModule } from './modules/officer/officer.module';
import { AdminModule } from './modules/admin/admin.module';
import { ChatModule } from './modules/chat/chat.module';
import { TicketModule } from './modules/ticket/ticket.module';
import { ErpModule } from './modules/erp/erp.module';
import { PushModule } from './modules/push/push.module';
import { WaybillModule } from './modules/waybill/waybill.module';
import { RegionalModule } from './modules/regional/regional.module';
import { BroadcastModule } from './modules/broadcast/broadcast.module';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsApiModule } from './modules/notifications/notifications.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsersModule } from './modules/users/users.module';
import { LoadingModule } from './modules/loading/loading.module';
import { ContactModule } from './modules/contact/contact.module';
import { RealtimeApiModule } from './modules/realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
    ErpRawModule,
    AuthModule,
    CustomerModule,
    OfficerModule,
    AdminModule,
    ChatModule,
    TicketModule,
    ErpModule,
    PushModule,
    WaybillModule,
    RegionalModule,
    BroadcastModule,
    AuditModule,
    NotificationsApiModule,
    UploadsModule,
    UsersModule,
    LoadingModule,
    ContactModule,
    RealtimeApiModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
