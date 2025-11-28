import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; // <--- 1. 导入这个
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RagModule } from './rag/rag.module';

@Module({
  imports: [
    // 2. 配置 ConfigModule，设为全局 global: true，这样 RAG 模块也能直接用
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    RagModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
