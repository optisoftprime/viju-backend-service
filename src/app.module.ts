import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './infrastructure/database/database.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
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
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
