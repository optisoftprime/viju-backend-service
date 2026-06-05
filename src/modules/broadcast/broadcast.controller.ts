import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BroadcastService } from './broadcast.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import {
  SendRegionalBroadcastDto,
  SendIndividualBroadcastDto,
  BroadcastHistoryFilterDto,
} from './dto/broadcast.dto';

@ApiTags('Admin Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/broadcasts')
export class BroadcastController {
  constructor(private readonly broadcastService: BroadcastService) {}

  @Post('regional')
  @ApiOperation({
    summary: 'Send a regional broadcast (PRD F15 AC2)',
  })
  async sendRegional(
    @CurrentUser() user: any,
    @Body() dto: SendRegionalBroadcastDto,
  ) {
    return this.broadcastService.sendRegional(user.id, dto);
  }

  @Post('individual')
  @ApiOperation({
    summary:
      'Send an individual broadcast — with optional delivery allowance (PRD F15 AC3-AC5)',
    description:
      'If deliveryAllowance > 0, the amount is credited to the wallet ' +
      'IMMEDIATELY (not next ERP sync). A Payment row with reference ' +
      '"Delivery Allowance" is created in the same transaction.',
  })
  async sendIndividual(
    @CurrentUser() user: any,
    @Body() dto: SendIndividualBroadcastDto,
  ) {
    return this.broadcastService.sendIndividual(user.id, dto);
  }

  @Get('history')
  @ApiOperation({ summary: 'Broadcast history with filters (PRD F15 AC7)' })
  async history(
    @Query() filter: BroadcastHistoryFilterDto,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.broadcastService.listHistory(filter, pagination);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Broadcast detail' })
  async detail(@Param('id') id: string) {
    return this.broadcastService.getDetail(id);
  }
}
