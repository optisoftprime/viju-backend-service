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
  ApiProduces,
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
} from './dto/admin.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { PaginatedCustomersResponseDto } from './dto/customer-response.dto';
import { MessageResponseDto } from '../../common/dto/message-response.dto';
import {
  DashboardStatsDto,
  TestCustomerDto,
  PaginatedOfficersResponseDto,
  CreatedOfficerDto,
  ProductFlyerDto,
} from './dto/admin-response.dto';

@ApiTags('Admin Portal')
@ApiBearerAuth()
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
    summary:
      'List customers with optional region filter + name/erpId search',
  })
  @ApiOkResponse({
    description: 'Paginated list of customers',
    type: PaginatedCustomersResponseDto,
  })
  async getAllCustomers(
    @Query() filter: CustomerFilterDto,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.adminService.getAllCustomers(filter, pagination);
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
    region: 'LAGOS' | 'SOUTH_WEST' | 'SOUTH_EAST' | 'NORTH' | undefined,
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
  @ApiOperation({ summary: 'Reassign customer to a new officer' })
  @ApiOkResponse({ type: MessageResponseDto })
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
  @ApiOperation({ summary: 'List all account officers' })
  @ApiOkResponse({ type: PaginatedOfficersResponseDto })
  async getOfficers(@Query() pagination: PaginationQueryDto) {
    return this.adminService.getOfficers(pagination);
  }

  @Post('officers')
  @ApiOperation({ summary: 'Create a new account officer' })
  @ApiOkResponse({ type: CreatedOfficerDto })
  async createOfficer(@Body() dto: CreateOfficerDto) {
    return this.adminService.createOfficer(dto);
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
    summary:
      'Reorder flyer cards — order in payload = order shown on mobile',
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
  @ApiOperation({ summary: 'Deactivate an officer account' })
  @ApiOkResponse({ type: MessageResponseDto })
  async deactivateOfficer(@Param('id') id: string) {
    await this.adminService.deactivateOfficer(id);
    return { message: 'Officer deactivated successfully' };
  }
}
