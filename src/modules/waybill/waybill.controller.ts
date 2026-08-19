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
import { WaybillService } from './waybill.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AcceptTermsDto, SubmitLoadingRequestDto } from './dto/waybill.dto';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import {
  PaginatedWaybillsResponseDto,
  AcceptTermsResponseDto,
  WaybillDto,
  WaybillDetailDto,
} from './dto/waybill-response.dto';

@ApiTags('Customer Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
@Controller('customers/me/waybills')
export class WaybillController {
  constructor(private readonly waybillService: WaybillService) {}

  @Get()
  @ApiOperation({
    summary: 'List the distributor’s loading requests / waybills',
  })
  @ApiOkResponse({ type: PaginatedWaybillsResponseDto })
  async list(
    @CurrentUser() user: any,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.waybillService.listForCustomer(user.id, pagination);
  }

  @Post('accept-terms')
  @ApiOperation({
    summary:
      'Record T&C acceptance, return external loading form URL',
    description:
      'Must be called before /customers/me/waybills POST or before the FE ' +
      'opens the external Google Form. The acceptance is valid for 1 hour.',
  })
  @ApiCreatedResponse({ type: AcceptTermsResponseDto })
  async acceptTerms(@CurrentUser() user: any, @Body() dto: AcceptTermsDto) {
    return this.waybillService.acceptTermsAndGetFormUrl(user.id, dto);
  }

  @Post()
  @ApiOperation({
    summary: 'Submit a loading request',
    description:
      'Direct in-app submission. The in-app form is out of scope; ' +
      'this endpoint is the dev surface and the future webhook target from ' +
      'the external form. Requires a T&C acceptance within the last hour. ' +
      'Returns the created request in PENDING_ASSIGNMENT status; regional ' +
      'admin is notified.',
  })
  @ApiCreatedResponse({ type: WaybillDto })
  async submit(@CurrentUser() user: any, @Body() dto: SubmitLoadingRequestDto) {
    return this.waybillService.submitLoadingRequest(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Waybill detail',
  })
  @ApiOkResponse({ type: WaybillDetailDto })
  async detail(@CurrentUser() user: any, @Param('id') id: string) {
    return this.waybillService.getForCustomer(user.id, id);
  }
}
