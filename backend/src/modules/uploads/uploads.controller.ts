import { Controller, Get, UseGuards, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

/**
 * ImageKit client-side upload authentication.
 * The private key never leaves the server — the browser uploads directly
 * to ImageKit using a short-lived signed token from this endpoint, which
 * keeps large image bytes off our own API entirely (no server bandwidth,
 * no memory pressure from multipart uploads).
 */
@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private config: ConfigService) {}

  /**
   * LandlordGuard used to sit here, from when photos on a listing were the
   * only thing anyone uploaded. A tenant now uploads verification documents
   * for the Renter's Passport — a SASSA letter, bank screenshots — and could
   * not get a token at all, so the Passport had no way to work.
   *
   * Signed in is the right bar. The token is short-lived and grants an upload,
   * not a read: ImageKit files under private paths are not publicly
   * addressable, and which path a document lands on is decided by the
   * verification service, not by the uploader.
   */
  @Get('imagekit-auth')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getImageKitAuth() {
    const privateKey = this.config.get<string>('imagekit.privateKey');
    // Without this, crypto.createHmac throws a bare TypeError and the client
    // sees an opaque 500. Photo upload is the gate on publishing a room, so
    // the failure needs to say exactly what is missing.
    if (!privateKey) {
      throw new ServiceUnavailableException(
        'Photo upload is not configured on this server. Set IMAGEKIT_PRIVATE_KEY, IMAGEKIT_PUBLIC_KEY and IMAGEKIT_URL_ENDPOINT in the backend .env file.',
      );
    }
    const token = crypto.randomUUID();
    const expire = Math.floor(Date.now() / 1000) + 30 * 60; // 30 min

    const signature = crypto
      .createHmac('sha1', privateKey)
      .update(token + expire)
      .digest('hex');

    return {
      token,
      expire,
      signature,
      publicKey: this.config.get<string>('imagekit.publicKey'),
      urlEndpoint: this.config.get<string>('imagekit.urlEndpoint'),
    };
  }
}
