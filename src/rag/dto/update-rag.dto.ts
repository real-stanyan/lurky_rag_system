import { PartialType } from '@nestjs/mapped-types';
import { CreateRagDto } from './create-rag.dto';

export class UpdateRagDto extends PartialType(CreateRagDto) {}
