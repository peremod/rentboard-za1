import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
/** Usage: @Roles('LANDLORD') or @Roles('LANDLORD', 'ADMIN') — paired with RolesGuard. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
