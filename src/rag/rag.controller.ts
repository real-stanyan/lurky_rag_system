///src/rag/rag.controller.ts

import { Body, Controller, Post } from '@nestjs/common';
import { RagService } from './rag.service';

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post('ask')
  async ask(@Body('question') question: string) {
    return this.ragService.ask(question);
  }
}
