import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { PushController } from './push.controller';
import { DevicesController } from './devices.controller';
import { PushService } from './push.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PushController, DevicesController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
