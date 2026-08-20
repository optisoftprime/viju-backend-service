import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Role gate for @Roles(...). The handler's list wins over the controller's,
 * so a class-level @Roles('ADMIN') can be widened on a single route.
 *
 * CC-01: the server is the authority on role access — the web app's sidebar
 * only hides links, and typing an /admin URL must still be refused here.
 * The refusal carries the message the FE renders verbatim.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest();
    if (!requiredRoles.includes(user?.role)) {
      throw new ForbiddenException(
        'You do not have permission to perform this action.',
      );
    }
    return true;
  }
}
