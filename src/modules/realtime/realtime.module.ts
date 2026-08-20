import { Module } from '@nestjs/common';
import { RealtimeController } from './realtime.controller';
import { RealtimeModule as RealtimeInfrastructureModule } from '../../infrastructure/realtime/realtime.module';

@Module({
  imports: [RealtimeInfrastructureModule],
  controllers: [RealtimeController],
})
export class RealtimeApiModule {}
