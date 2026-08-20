import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiProduces,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  ReassignOfficerDto,
  CreateOfficerDto,
  CreateTestCustomerDto,
  CreateProductFlyerDto,
  UpdateProductFlyerDto,
  ReorderProductFlyersDto,
  CustomerFilterDto,
  OfficerFilterDto,
  UpdateOfficerStatusDto,
} from './dto/admin.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Region } from '../../common/region/region.constants';
import { PaginatedCustomersResponseDto } from './dto/customer-response.dto';
import { MessageResponseDto } from '../../common/dto/message-response.dto';
import {
  DashboardStatsDto,
  TestCustomerDto,
  PaginatedOfficersResponseDto,
  CreatedOfficerDto,
  ProductFlyerDto,
  OfficerDetailDto,
  BulkReassignResponseDto,
  OfficerStatusDto,
} from './dto/admin-response.dto';

/**
 * CC-01: every route here is ADMIN-only at the server, regardless of what the
 * web app chooses to render. A handler-level @Roles(...) overrides the
 * class-level one — used by GET /admin/officers, which regional admins also
 * need (RA-05) but only ever for their own region.
 */
@ApiTags('Admin Portal')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@ApiForbiddenResponse({
  description:
    'Caller is not an ADMIN: ' +
    '`{ "message": "You do not have permission to perform this action.", "statusCode": 403 }`',
})
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get aggregate organization dashboard stats' })
  @ApiOkResponse({ type: DashboardStatsDto })
  async getDashboard() {
    return this.adminService.getDashboardStats();
  }

  @Get('customers')
  @ApiOperation({
    summary: 'List customers with optional region filter + name/erpId search',
    description:
      'Sortable (US-09.3): pass `sortBy` with one of name | erpId | region | ' +
      'outstandingBalance | supportTickets, plus `sortOrder` (asc | desc, ' +
      'default desc). With no `sortBy` the ordering is unchanged (erpId ' +
      'ascending). An unrecognised `sortBy` is rejected with 400 rather than ' +
      'silently ignored. Only the row order changes — the envelope is the same.',
  })
  @ApiOkResponse({
    description: 'Paginated list of customers',
    type: PaginatedCustomersResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Unknown sortBy / sortOrder, or invalid pagination params',
  })
  async getAllCustomers(@Query() query: CustomerFilterDto) {
    return this.adminService.getAllCustomers(query, query);
  }

  @Get('customers/export.csv')
  @ApiOperation({
    summary: 'Export filtered customer list as CSV',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'CSV file of filtered customers',
    schema: { type: 'string', format: 'binary' },
  })
  async exportCustomers(
    @Query('region')
    region: Region | undefined,
    @Query('search') search: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.adminService.exportCustomersCsv({ region, search });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="viju-customers.csv"',
    );
    res.send(csv);
  }

  @Patch('customers/:id/reassign')
  @ApiOperation({
    summary: 'Reassign customer to a new officer',
    description:
      'Moves both the primary pointer and the CustomerOfficer join row, so ' +
      'the chat thread and every ticket for this customer follow the ' +
      'assignment (US-13.5) — the new officer sees the complete history and ' +
      'the previous officer loses access. Side effect (US-13.4): an ' +
      'ASSIGNMENT notification is created for the receiving officer.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    description: 'New officer is inactive or in a different region',
  })
  @ApiNotFoundResponse({ description: 'Customer not found' })
  async reassignOfficer(
    @Param('id') id: string,
    @Body() dto: ReassignOfficerDto,
  ) {
    await this.adminService.reassignOfficer(id, dto);
    return { message: 'Officer reassigned successfully' };
  }

  @Post('customers')
  @ApiOperation({
    summary: 'Create a test customer (mocks ERP customer sync)',
    description:
      'Stand-in for the ERP customer sync until that integration lands. ' +
      'Lets FE/QA seed any phone number for OTP flow testing without waiting on ERP. ' +
      'Replace or remove once /erp/sync/customers is wired up.',
  })
  @ApiOkResponse({ type: TestCustomerDto })
  async createTestCustomer(@Body() dto: CreateTestCustomerDto) {
    return this.adminService.createTestCustomer(dto);
  }

  @Get('officers')
  @Roles('ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: 'List staff officers (region filter + search + sort)',
    description:
      'ADMIN sees every region and may narrow with `region`. REGIONAL_ADMIN ' +
      "is forced to their own token's region and any client-supplied " +
      '`region` is ignored (RA-05) — a user cannot widen their scope by ' +
      'editing the query string.\n\n' +
      'Pass `role=LOADING_OFFICER` to list loading officers for the ' +
      'assign-loading-officer picker (RA-06); it defaults to OFFICER.\n\n' +
      'Sortable (US-09.3): `sortBy` accepts name | email | region | ' +
      'customers | createdAt | lastLoginAt | supportTickets with `sortOrder` ' +
      '(asc | desc, default desc). Default ordering (no `sortBy`) is name ' +
      'ascending. An unknown `sortBy` is rejected with 400.',
  })
  @ApiOkResponse({ type: PaginatedOfficersResponseDto })
  @ApiBadRequestResponse({
    description: 'Unknown sortBy / sortOrder, or invalid pagination params',
  })
  async getOfficers(
    @CurrentUser() user: { role: string; region?: Region | null },
    @Query() query: OfficerFilterDto,
  ) {
    // RA-03: region-scoped roles filter by the TOKEN's region, never by the
    // query param, which the caller controls.
    const region =
      user.role === 'REGIONAL_ADMIN'
        ? (user.region ?? undefined)
        : query.region;
    return this.adminService.getOfficers({ ...query, region }, query);
  }

  @Post('officers')
  @ApiOperation({
    summary: 'Create a new account officer',
    description:
      'Side effect (US-15.3): the officer is emailed their login ' +
      'credentials. `emailSent` reports whether delivery succeeded — the ' +
      'officer record is created either way, so the FE can soften its ' +
      'success wording instead of promising an email that never arrived.',
  })
  @ApiCreatedResponse({ type: CreatedOfficerDto })
  @ApiBadRequestResponse({ description: 'Email already in use' })
  async createOfficer(@Body() dto: CreateOfficerDto) {
    return this.adminService.createOfficer(dto);
  }

  @Get('officers/:id')
  @ApiOperation({
    summary:
      'Officer detail — profile, region, role, distributors, open tickets, last login',
  })
  @ApiOkResponse({ type: OfficerDetailDto })
  async getOfficer(@Param('id') id: string) {
    return this.adminService.getOfficerDetail(id);
  }

  @Patch('officers/:id')
  @ApiOperation({
    summary: 'Deactivate or reactivate an officer',
    description:
      'US-15.4. `{"isActive": false}` deactivates, `{"isActive": true}` ' +
      'reactivates. Deactivation is REFUSED with 409 while the officer still ' +
      'holds customers; the error body carries `code` and the exact ' +
      '`assignedCustomers` count so the admin can be told how many to move, ' +
      'then call PATCH /admin/officers/{id}/reassign-customers and retry.\n\n' +
      'A deactivated officer can no longer log in or refresh a session ' +
      '(US-15.5), but their chat and ticket history stays readable in the ' +
      'admin audit views.',
  })
  @ApiOkResponse({ type: OfficerStatusDto })
  @ApiNotFoundResponse({ description: 'Officer not found' })
  @ApiConflictResponse({
    description:
      'Officer still has assigned customers: `{ "message": "Reassign this ' +
      'officer\'s 14 customers before deactivating.", "code": ' +
      '"OFFICER_HAS_CUSTOMERS", "assignedCustomers": 14, "statusCode": 409 }`',
  })
  async updateOfficerStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOfficerStatusDto,
  ) {
    return this.adminService.setOfficerActive(id, dto.isActive);
  }

  @Patch('officers/:id/reassign-customers')
  @ApiOperation({
    summary:
      'Reassign ALL of an officer’s customers to another officer (do this before deactivating)',
    description:
      'Moves the primary pointer and the CustomerOfficer rows for every ' +
      'customer, so chat threads and tickets follow them (US-13.5). Side ' +
      'effect (US-13.4): one summary ASSIGNMENT notification for the ' +
      'receiving officer.',
  })
  @ApiOkResponse({ type: BulkReassignResponseDto })
  @ApiBadRequestResponse({
    description: 'Target officer is the same, inactive, or in another region',
  })
  @ApiNotFoundResponse({ description: 'Officer not found' })
  async reassignAllCustomers(
    @Param('id') id: string,
    @Body() dto: ReassignOfficerDto,
  ) {
    return this.adminService.reassignAllCustomers(id, dto.newOfficerId);
  }

  // ─── Product Flyer ──────────────────────────
  @Get('product-flyers')
  @ApiOperation({ summary: 'List product flyer cards in current order' })
  @ApiOkResponse({ type: [ProductFlyerDto] })
  async listFlyers() {
    return this.adminService.listProductFlyers();
  }

  @Post('product-flyers')
  @ApiOperation({
    summary:
      'Create a product flyer card (uploads come pre-resolved as imageUrl)',
  })
  @ApiOkResponse({ type: ProductFlyerDto })
  async createFlyer(
    @Body() dto: CreateProductFlyerDto,
    @CurrentUser() user: any,
  ) {
    return this.adminService.createProductFlyer(dto, user.id);
  }

  @Patch('product-flyers/reorder')
  @ApiOperation({
    summary: 'Reorder flyer cards — order in payload = order shown on mobile',
  })
  @ApiOkResponse({ type: [ProductFlyerDto] })
  async reorderFlyers(@Body() dto: ReorderProductFlyersDto) {
    return this.adminService.reorderProductFlyers(dto);
  }

  @Patch('product-flyers/:id')
  @ApiOperation({ summary: 'Update / deactivate a flyer card' })
  @ApiOkResponse({ type: ProductFlyerDto })
  async updateFlyer(
    @Param('id') id: string,
    @Body() dto: UpdateProductFlyerDto,
  ) {
    return this.adminService.updateProductFlyer(id, dto);
  }

  @Delete('product-flyers/:id')
  @ApiOperation({ summary: 'Delete a flyer card permanently' })
  @ApiOkResponse({ type: MessageResponseDto })
  async deleteFlyer(@Param('id') id: string) {
    await this.adminService.deleteProductFlyer(id);
    return { message: 'Product flyer deleted' };
  }

  @Delete('officers/:id')
  @ApiOperation({
    summary: '[Deprecated] Deactivate an officer account',
    description:
      'Kept for existing clients. Prefer PATCH /admin/officers/{id} with ' +
      '`{"isActive": false}`, which uses the same rules but returns the ' +
      'updated officer and a machine-readable 409 when customers remain.',
    deprecated: true,
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiNotFoundResponse({ description: 'Officer not found' })
  @ApiConflictResponse({
    description: 'Officer still has assigned customers (OFFICER_HAS_CUSTOMERS)',
  })
  async deactivateOfficer(@Param('id') id: string) {
    await this.adminService.setOfficerActive(id, false);
    return { message: 'Officer deactivated successfully' };
  }
}
