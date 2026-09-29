import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LandlordGuard } from '../../common/guards/landlord.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StorefrontService } from './storefront.service';
import { UpdateStorefrontDto } from './dto/storefront.dto';

/**
 * The landlord's own storefront settings. Authed, landlord-only.
 *
 * Separate controller from the public read below, so the guard on this one
 * cannot leak onto that one by being added to a shared class.
 */
@ApiTags('landlord')
@Controller('landlord/storefront')
@UseGuards(JwtAuthGuard, LandlordGuard)
@ApiBearerAuth()
export class StorefrontAdminController {
  constructor(private storefront: StorefrontService) {}

  @Get()
  @ApiOperation({
    summary: 'Your storefront settings',
    description:
      'Mints the slug on first read rather than at registration — a slug is a public URL, and creating one for every landlord who signs up would put pages in the sitemap for people who never asked.',
  })
  mine(@CurrentUser() user: { id: string }) {
    return this.storefront.mine(user.id);
  }

  @Patch()
  @ApiOperation({
    summary: 'Edit your bio and logo, or publish the page',
    description:
      'The slug is NOT editable. It is in the sitemap and in whatever anyone has shared, so changing it would 404 every link that pointed at the page.',
  })
  update(@CurrentUser() user: { id: string }, @Body() dto: UpdateStorefrontDto) {
    return this.storefront.updateMine(user.id, dto);
  }
}

/**
 * The public page. No guard, deliberately — this is the SEO surface.
 *
 * Its own controller with no class-level guard at all, so nothing can be added
 * to the authed controller above and silently apply here.
 */
@ApiTags('storefront')
@Controller('storefronts')
export class StorefrontPublicController {
  constructor(private storefront: StorefrontService) {}

  @Get(':slug')
  @ApiOperation({
    summary: 'A landlord’s public storefront',
    description:
      'Anything not deliberately published answers 404 — not 403 — so nobody can enumerate which landlords exist or which have hidden their page.',
  })
  bySlug(@Param('slug') slug: string) {
    return this.storefront.publicBySlug(slug);
  }
}
