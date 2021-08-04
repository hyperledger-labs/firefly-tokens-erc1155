import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TokensModule } from './tokens/tokens.module';
import { EventStreamModule } from './event-stream/event-stream.module';

@Module({
  imports: [TokensModule, EventStreamModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
