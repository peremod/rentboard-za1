import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Extracts req.user (set by JwtAuthGuard). Usage: @CurrentUser() user: { id, email, role, fullName } */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user;
});
