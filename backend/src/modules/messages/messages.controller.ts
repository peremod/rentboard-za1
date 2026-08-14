import { Controller, Get, Post, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/send-message.dto';

@ApiTags('messages')
@Controller('applications/:applicationId/messages')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MessagesController {
  constructor(private messagesService: MessagesService) {}

  @Get()
  getThread(@Param('applicationId', ParseUUIDPipe) applicationId: string, @CurrentUser() user: { id: string }) {
    return this.messagesService.getThread(applicationId, user.id);
  }

  @Post()
  send(
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.messagesService.send(applicationId, user.id, dto);
  }
}
