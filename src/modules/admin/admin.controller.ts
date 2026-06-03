import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  ReassignOfficerDto,
  CreateOfficerDto,
  CreateTestCustomerDto,
} from './dto/admin.dto';

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

  @Delete('officers/:id')
  @ApiOperation({ summary: 'Deactivate an officer account' })
  async deactivateOfficer(@Param('id') id: string) {
    await this.adminService.deactivateOfficer(id);
    return { message: 'Officer deactivated successfully' };
  }
}
