import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';

/**
 * Exported rather than kept private because every module that stores a file is
 * a module that will one day have to unstore it, and the alternative — each one
 * calling ImageKit itself — is how the original deletion gap went unnoticed in
 * the first place.
 */
@Module({
  controllers: [StorageController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
