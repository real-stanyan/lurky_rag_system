import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { Pinecone } from '@pinecone-database/pinecone';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';

@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private llm: ChatGoogleGenerativeAI;
  private pinecone: Pinecone;
  private indexName: string;
  private indexHost: string = '';

  constructor(private configService: ConfigService) {
    // 1. 初始化 LLM
    // 建议使用较快的模型 (如 flash) 以减少两轮 LLM 调用带来的延迟
    this.llm = new ChatGoogleGenerativeAI({
      model: 'gemini-2.5-flash', // 确保模型名称正确
      temperature: 0.3,
      apiKey: this.configService.getOrThrow<string>('GOOGLE_API_KEY'),
    });

    // 2. 初始化 Pinecone
    this.pinecone = new Pinecone({
      apiKey: this.configService.getOrThrow<string>('PINECONE_API_KEY'),
    });

    this.indexName = this.configService.getOrThrow<string>('PINECONE_INDEX');
  }

  async onModuleInit() {
    try {
      const indexDescription = await this.pinecone.describeIndex(
        this.indexName,
      );
      this.indexHost = indexDescription.host;
      this.logger.log(`Pinecone Index Host found: ${this.indexHost}`);
    } catch (error) {
      this.logger.error('Failed to get Pinecone index host', error);
    }
  }

  /**
   * 辅助方法：将用户问题翻译成英文
   * 这一步使用 temperature: 0 确保翻译准确且无废话
   */
  private async translateToEnglish(text: string): Promise<string> {
    // 如果包含纯 ASCII 字符（简单的英文判断），可以跳过翻译节省时间，
    // 但为了保险起见，这里统一走 LLM，因为英文里也可能夹杂其他语言
    const template = `
    You are a professional translator. 
    Translate the following text to **English**. 
    If the text is already in English, return it exactly as is.
    Do not add any explanations, notes, or extra punctuation. Just the translated text.

    Text: {text}
    `;

    const prompt = ChatPromptTemplate.fromTemplate(template);
    const chain = prompt.pipe(this.llm).pipe(new StringOutputParser());

    const res = await chain.invoke({ text });
    return res.trim(); // 去除可能的首尾空格
  }

  /**
   * 核心功能：翻译 -> 检索 -> 本地化回答
   */
  async ask(originalQuestion: string) {
    try {
      if (!this.indexHost) {
        const desc = await this.pinecone.describeIndex(this.indexName);
        this.indexHost = desc.host;
      }

      // =========================================================
      // 步骤 1: 将用户问题转为英文 (Query Translation)
      // =========================================================
      const englishQuestion = await this.translateToEnglish(originalQuestion);

      this.logger.log(`原始问题: "${originalQuestion}"`);
      this.logger.log(`翻译后用于检索的问题: "${englishQuestion}"`);

      // =========================================================
      // 步骤 2: 使用英文问题去 Pinecone 检索
      // =========================================================
      const NAMESPACE = 'lurky-products'; // <--- 这里改成你控制台里看到的名字
      const searchUrl = `https://${this.indexHost}/records/namespaces/${NAMESPACE}/search`;

      const response = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Api-Key': this.configService.getOrThrow<string>('PINECONE_API_KEY'),
          'Content-Type': 'application/json',
          'X-Pinecone-API-Version': '2024-10',
        },
        body: JSON.stringify({
          query: {
            inputs: { text: englishQuestion }, // <--- 这里传入英文问题
            top_k: 4,
          },
          fields: ['id', 'text'],
        }),
      });

      if (!response.ok) {
        throw new Error(`Pinecone Search Error: ${response.statusText}`);
      }

      const searchResult = await response.json();
      const hits = searchResult.result?.hits || [];

      // 即使没有命中，也需要用对应的语言回复用户
      if (hits.length === 0) {
        // 这里我们可以做一个简单的回退，或者让 LLM 用原语言礼貌拒绝
        // 为了简单，直接返回一个硬编码的通用多语言回复，或者再调用一次 LLM 生成拒绝语
        // 这里演示简单的：
        return {
          question: originalQuestion,
          englishQuestion,
          answer: 'No relevant product information found. (未找到相关产品信息)',
        };
      }

      const context = hits
        .map(
          (hit: any) =>
            hit.fields?.combined_context || JSON.stringify(hit.fields),
        )
        .join('\n\n---\n\n');

      // =========================================================
      // 步骤 3: 生成回答 (Cross-Lingual Generation)
      // =========================================================
      const finalTemplate = `
      You are "Lurky Bot", the official AI assistant for the Lurky brand.

      Task:
      Answer the question based strictly on the provided Context.
      
      CRITICAL INSTRUCTION:
      The user asked the question in this language: "{original_question}".
      **You MUST answer in the same language as the "{original_question}".**
      (e.g., if the user asked in Chinese, answer in Chinese. If French, answer in French).

      Context Information:
      {context}

      English Translated Question (for your understanding):
      {english_question} 

      Original User Question (Target Language):
      {original_question}
      `;

      const prompt = ChatPromptTemplate.fromTemplate(finalTemplate);
      const chain = prompt.pipe(this.llm).pipe(new StringOutputParser());

      // === 修改这里 ===
      const answer = await chain.invoke({
        context: context,
        // 这里必须和模板里的 {english_question} 保持一致
        english_question: englishQuestion,
        original_question: originalQuestion,
      });

      return {
        originalQuestion,
        englishQuestion,
        answer,
      };
    } catch (error) {
      this.logger.error('RAG Process Error:', error);
      return {
        question: originalQuestion,
        answer: '系统繁忙，请稍后再试 (System Error).',
        error: error.message,
      };
    }
  }
}
