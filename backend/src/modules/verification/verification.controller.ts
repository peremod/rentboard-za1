import { Controller, Get, Post, Patch, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LandlordGuard } from '../../common/guards/landlord.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VerificationService } from './verification.service';
import { SubmitVerificationDto } from './dto/submit-verification.dto';
import { ReviewVerificationDto } from './dto/review-verification.dto';

@ApiTags('verification')
@Controller('verification')
export class VerificationController {
  constructor(private verificationService: VerificationService) {}

  @Get('mine')
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "The landlord's own verification requests and their status" })
  listMine(@CurrentUser() user: { id: string }) {
    return this.verificationService.listMine(user.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, LandlordGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit a document for verification' })
  submit(@Body() dto: SubmitVerificationDto, @CurrentUser() user: { id: string }) {
    return this.verificationService.submit(dto, user.id);
  }

  @Get('pending')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin review queue' })
  listPending() {
    return this.verificationService.listPending();
  }

  @Patch(':id/review')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve or reject. The document is deleted either way.' })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewVerificationDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.verificationService.review(id, dto, user.id);
  }
}
