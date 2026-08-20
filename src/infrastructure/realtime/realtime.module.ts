import { Module } from '@nestjs/common';
import { RealtimeService } from './realtime.service';

/**
 * Exports the server-push bus. Imported by every module that emits a frame
 * (notifications, chat, tickets) and by the module that serves the stream.
 */
@Module({
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
