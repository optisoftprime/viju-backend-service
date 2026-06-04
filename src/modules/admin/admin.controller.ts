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
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
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
} from './dto/admin.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Admin Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get aggregate organization dashboard stats' })
  async getDashboard() {
    return this.adminService.getDashboardStats();
  }

  @Get('customers')
  @ApiOperation({
    summary: 'List customers with optional region filter + name/erpId search (PRD F14 AC5)',
  })
  async getAllCustomers(
    @Query('region')
    region?: 'LAGOS' | 'SOUTH_WEST' | 'SOUTH_EAST' | 'NORTH',
    @Query('search') search?: string,
  ) {
    return this.adminService.getAllCustomers({ region, search });
  }

  @Get('customers/export.csv')
  @ApiOperation({ summary: 'Export filtered customer list as CSV (PRD F14 AC6)' })
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
      'Stand-in for the ERP customer sync (PRD F8) until that integration lands. ' +
      'Lets FE/QA seed any phone number for OTP flow testing without waiting on ERP. ' +
      'Replace or remove once /erp/sync/customers is wired up.',
  })
  async createTestCustomer(@Body() dto: CreateTestCustomerDto) {
    return this.adminService.createTestCustomer(dto);
  }

  @Get('officers')
  @ApiOperation({ summary: 'List all account officers' })
  async getOfficers() {
    return this.adminService.getOfficers();
  }

  @Post('officers')
  @ApiOperation({ summary: 'Create a new account officer' })
  async createOfficer(@Body() dto: CreateOfficerDto) {
    return this.adminService.createOfficer(dto);
  }

  // ─── Product Flyer (PRD F19) ──────────────────────────
  @Get('product-flyers')
  @ApiOperation({ summary: 'List product flyer cards in current order' })
  async listFlyers() {
    return this.adminService.listProductFlyers();
  }

  @Post('product-flyers')
  @ApiOperation({
    summary:
      'Create a product flyer card (uploads come pre-resolved as imageUrl)',
  })
  async createFlyer(
    @Body() dto: CreateProductFlyerDto,
    @CurrentUser() user: any,
  ) {
    return this.adminService.createProductFlyer(dto, user.id);
  }

  @Patch('product-flyers/reorder')
  @ApiOperation({
    summary:
      'Reorder flyer cards — order in payload = order shown on mobile (PRD F19 AC4)',
  })
  async reorderFlyers(@Body() dto: ReorderProductFlyersDto) {
    return this.adminService.reorderProductFlyers(dto);
  }

  @Patch('product-flyers/:id')
  @ApiOperation({ summary: 'Update / deactivate a flyer card' })
  async updateFlyer(
    @Param('id') id: string,
    @Body() dto: UpdateProductFlyerDto,
  ) {
    return this.adminService.updateProductFlyer(id, dto);
  }

  @Delete('product-flyers/:id')
  @ApiOperation({ summary: 'Delete a flyer card permanently' })
  async deleteFlyer(@Param('id') id: string) {
    await this.adminService.deleteProductFlyer(id);
    return { message: 'Product flyer deleted' };
  }

  @Delete('officers/:id')
  @ApiOperation({ summary: 'Deactivate an officer account' })
  async deactivateOfficer(@Param('id') id: string) {
    await this.adminService.deactivateOfficer(id);
    return { message: 'Officer deactivated successfully' };
  }
}
