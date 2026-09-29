import { Module } from '@nestjs/common';
import { StorefrontAdminController, StorefrontPublicController } from './storefront.controller';
import { StorefrontService } from './storefront.service';

/**
 * Exported because the sitemap needs every published slug — a public page that
 * is not in the sitemap is a retention feature pretending to be an SEO one.
 */
@Module({
  controllers: [StorefrontAdminController, StorefrontPublicController],
  providers: [StorefrontService],
  exports: [StorefrontService],
})
export class StorefrontModule {}
