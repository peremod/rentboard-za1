import { Controller, Get, Query, Header } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PlacesService } from './places.service';

/** Public: place data is reference data, not user data. */
@ApiTags('places')
@Controller('places')
export class PlacesController {
  constructor(private placesService: PlacesService) {}

  @Get('suggest')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({ summary: 'Suburb, city and province suggestions' })
  suggest(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.placesService.suggest(q ?? '', limit ? Math.min(+limit, 10) : 8);
  }

  @Get('resolve')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({ summary: 'Resolve free text to a place, with its city and province' })
  resolve(@Query('q') q: string) {
    return this.placesService.resolve(q ?? '');
  }
}
