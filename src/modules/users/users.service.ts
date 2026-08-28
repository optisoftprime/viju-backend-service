import {
  BadRequestException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { assertUploadUrl } from '../../common/uploads/upload-url';

/** The signed-in principal, as the controller reads it off the JWT. */
interface Principal {
  id: string;
  role: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** True for the one role stored in `Customer` rather than `Staff`. */
  private isCustomer(role: string): boolean {
    return role === 'CUSTOMER';
  }

  /**
   * RA-03: the signed-in principal, including the region that scopes every
   * region-filtered endpoint. Re-read from the database rather than echoed
   * from the token so a reassignment or deactivation shows up immediately.
   */
  async getMe(user: Principal) {
    if (this.isCustomer(user.role)) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          region: true,
          profilePhotoUrl: true,
        },
      });
      if (!customer) throw new NotFoundException('User not found');
      return {
        ...customer,
        role: 'CUSTOMER' as const,
        type: 'CUSTOMER' as const,
        isActive: true,
        lastLoginAt: null,
      };
    }

    const staff = await this.prisma.staff.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        region: true,
        isActive: true,
        lastLoginAt: true,
        // PR-1 — a real column now, rather than the hard-coded null this
        // returned before staff had anywhere to store a picture.
        profilePhotoUrl: true,
      },
    });
    if (!staff) throw new NotFoundException('User not found');
    return { ...staff, type: 'STAFF' as const };
  }

  /**
   * PR-1 — set or clear the caller's OWN profile picture.
   *
   * There is deliberately no id in the path: the account is the one on the
   * token, so one staff member cannot set another's picture. Works for every
   * signed-in role — an admin has a picture too, and a CUSTOMER calling this
   * updates the same column `PATCH /customers/me/photo` writes.
   *
   * Two steps by design: the client uploads through `POST /uploads` first and
   * sends the returned URL here, which reuses that route's storage handling
   * and size/type rules rather than growing a second multipart endpoint.
   *
   * The URL is checked against this deployment's own upload hosts — see
   * `assertUploadUrl` for why an arbitrary URL is refused. `null` (or an empty
   * string) clears the picture.
   *
   * Answers the REFRESHED PROFILE, identical in shape to `GET /users/me`, so
   * the navbar and sidebar avatar can be updated from this one response
   * without a second read.
   */
  async updateMyPhoto(user: Principal, profilePhotoUrl: string | null) {
    const url = assertUploadUrl(profilePhotoUrl);

    if (this.isCustomer(user.role)) {
      await this.prisma.customer.update({
        where: { id: user.id },
        data: { profilePhotoUrl: url },
      });
    } else {
      await this.prisma.staff.update({
        where: { id: user.id },
        data: { profilePhotoUrl: url },
      });
    }

    return this.getMe(user);
  }

  /**
   * PR-2 — change the caller's OWN password, proving they know the current one.
   *
   * Deliberately NOT the forgot-password flow: that proves control of an
   * inbox, which is a different question. Requiring the current password is
   * what makes this safe to expose on a signed-in session that may have been
   * left open on a shared machine.
   *
   * `confirmNewPassword` is not accepted — its only job is catching a typo in
   * the form, and the server has no use for a second copy of a value it
   * already has.
   *
   * SESSIONS ARE NOT INVALIDATED. See the note on the controller: refresh
   * tokens keep working, so the user stays signed in here and elsewhere. That
   * is a deliberate choice and the frontend needs to know it, so it is stated
   * rather than left to be discovered from a 401.
   */
  async changeMyPassword(
    user: Principal,
    currentPassword: string,
    newPassword: string,
  ) {
    const account = this.isCustomer(user.role)
      ? await this.prisma.customer.findUnique({
          where: { id: user.id },
          select: { id: true, password: true },
        })
      : await this.prisma.staff.findUnique({
          where: { id: user.id },
          select: { id: true, password: true },
        });

    if (!account) throw new NotFoundException('User not found');

    // An account provisioned without a local password (ERP-mirrored staff)
    // has nothing to compare against. Refusing is right: there is no current
    // password for the caller to have proved knowledge of.
    if (!account.password) {
      throw new BadRequestException({
        message:
          'This account has no password set. Use the password-reset flow instead.',
        code: 'NO_PASSWORD_SET',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    // THE POINT OF THE FLOW: compare against the stored hash before anything
    // is written.
    const matches = await bcrypt.compare(currentPassword, account.password);
    if (!matches) {
      throw new BadRequestException({
        message: 'Your current password is not correct.',
        code: 'INVALID_CURRENT_PASSWORD',
        field: 'currentPassword',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    // Compared against the HASH rather than the submitted string, so this
    // catches a re-use even when the two differ in some way bcrypt ignores.
    if (await bcrypt.compare(newPassword, account.password)) {
      throw new BadRequestException({
        message: 'The new password must be different from your current one.',
        code: 'PASSWORD_REUSED',
        field: 'newPassword',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    if (this.isCustomer(user.role)) {
      await this.prisma.customer.update({
        where: { id: user.id },
        data: { password: hashed },
      });
    } else {
      await this.prisma.staff.update({
        where: { id: user.id },
        data: { password: hashed },
      });
    }

    return { success: true, message: 'Password changed' };
  }
}
