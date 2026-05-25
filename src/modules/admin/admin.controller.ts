import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReassignOfficerDto, CreateOfficerDto } from './dto/admin.dto';

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
  @ApiOperation({ summary: 'Get all customers across the organization' })
  async getAllCustomers() {
    return this.adminService.getAllCustomers();
  }

  @Patch('customers/:id/reassign')
  @ApiOperation({ summary: 'Reassign customer to a new officer' })
  async reassignOfficer(@Param('id') id: string, @Body() dto: ReassignOfficerDto) {
    await this.adminService.reassignOfficer(id, dto);
    return { message: 'Officer reassigned successfully' };
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

  @Delete('officers/:id')
  @ApiOperation({ summary: 'Deactivate an officer account' })
  async deactivateOfficer(@Param('id') id: string) {
    await this.adminService.deactivateOfficer(id);
    return { message: 'Officer deactivated successfully' };
  }
}
