import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { BroadcastService } from './broadcast.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  SendRegionalBroadcastDto,
  SendIndividualBroadcastDto,
  BroadcastHistoryFilterDto,
} from './dto/broadcast.dto';
import {
  BroadcastDto,
  BroadcastDetailDto,
  PaginatedBroadcastHistoryResponseDto,
} from './dto/broadcast-response.dto';

@ApiTags('Admin Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/broadcasts')
export class BroadcastController {
  constructor(private readonly broadcastService: BroadcastService) {}

  @Post('regional')
  @ApiOperation({
    summary: 'Send a regional broadcast',
  })
  @ApiCreatedResponse({
    description: 'The created regional broadcast record.',
    type: BroadcastDto,
  })
  async sendRegional(
    @CurrentUser() user: any,
    @Body() dto: SendRegionalBroadcastDto,
  ) {
    return this.broadcastService.sendRegional(user.id, dto);
  }

  @Post('individual')
  @ApiOperation({
    summary: 'Send an individual broadcast — with optional delivery allowance',
    description:
      'If deliveryAllowance > 0, the amount is credited to the wallet ' +
      'IMMEDIATELY (not next ERP sync). A Payment row with reference ' +
      '"Delivery Allowance" is created in the same transaction.',
  })
  @ApiCreatedResponse({
    description: 'The created individual broadcast record.',
    type: BroadcastDto,
  })
  async sendIndividual(
    @CurrentUser() user: any,
    @Body() dto: SendIndividualBroadcastDto,
  ) {
    return this.broadcastService.sendIndividual(user.id, dto);
  }

  @Get('history')
  @ApiOperation({ summary: 'Broadcast history with filters' })
  @ApiOkResponse({
    description: 'Paginated broadcast history (newest first).',
    type: PaginatedBroadcastHistoryResponseDto,
  })
  async history(@Query() query: BroadcastHistoryFilterDto) {
    return this.broadcastService.listHistory(query, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Broadcast detail' })
  @ApiOkResponse({
    description:
      'Full broadcast detail incl. sender, target customer and allowance payment.',
    type: BroadcastDetailDto,
  })
  async detail(@Param('id') id: string) {
    return this.broadcastService.getDetail(id);
  }
}
