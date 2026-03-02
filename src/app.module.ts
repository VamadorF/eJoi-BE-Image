import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ImageModule } from './image/image.module';
import { LlmModule } from './llm/llm.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes the configuration available globally
    }),
    ThrottlerModule.forRoot({
      throttlers:[
        {
          ttl: 60, // Time to live in seconds
          limit: 10, // Maximum number of requests allowed in the ttl period
        },
      ],
    }),
    AuthModule,
    ImageModule,
    LlmModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
