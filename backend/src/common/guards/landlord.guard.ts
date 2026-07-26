import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class LandlordGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user || (user.role !== 'LANDLORD' && user.role !== 'ADMIN')) {
      throw new ForbiddenException('Landlord account required');
    }
    return true;
  }
}
