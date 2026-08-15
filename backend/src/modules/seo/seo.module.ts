import { Module } from '@nestjs/common';
import { SeoController } from './seo.controller';

@Module({ controllers: [SeoController] })
export class SeoModule {}
