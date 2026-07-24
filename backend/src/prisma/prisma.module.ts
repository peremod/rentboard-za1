import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** @Global() — available everywhere without re-importing per feature module. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
