import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OfficerService } from './officer.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Officer Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OFFICER', 'ADMIN')
@Controller('officers')
export class OfficerController {
  constructor(private readonly officerService: OfficerService) {}

  @Get('customers')
  @ApiOperation({ summary: 'Get list of customers assigned to the officer' })
  async getCustomers(@CurrentUser() user: any) {
    return this.officerService.getAssignedCustomers(user.id);
  }

  @Get('customers/:id')
  @ApiOperation({ summary: 'Get detailed account view for a specific assigned customer' })
  async getCustomerDetail(@CurrentUser() user: any, @Param('id') customerId: string) {
    return this.officerService.getCustomerDetail(user.id, customerId);
  }

  @Get('stock')
  @ApiOperation({ summary: 'Get current stock levels from the ERP' })
  async getStock() {
    return this.officerService.getStock();
  }
}
