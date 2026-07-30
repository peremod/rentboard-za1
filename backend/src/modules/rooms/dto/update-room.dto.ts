import { PartialType } from '@nestjs/swagger';
import { CreateRoomDto } from './create-room.dto';

/** All CreateRoomDto fields, optional — used for PATCH /rooms/:id (edits) and auto-save drafts. */
export class UpdateRoomDto extends PartialType(CreateRoomDto) {}
