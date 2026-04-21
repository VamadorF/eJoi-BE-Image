import { Inject, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ImageModule } from './image/image.module';
import { LlmModule } from './llm/llm.module';
import { StorageModule } from './storage/storage.module';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes the configuration available globally
    }),
    CacheModule.registerAsync({
    isGlobal: true,
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: async (config: ConfigService) => ({
        store: await redisStore({
          url: config.get('REDIS_URL'),
          ttl: 60_000
        }),
      }),
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
    StorageModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
