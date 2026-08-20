import { Body, Controller, Ip, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ContactService } from './contact.service';
import {
  RateLimit,
  RateLimitGuard,
} from '../../common/guards/rate-limit.guard';
import { CreateContactMessageDto } from './dto/contact.dto';
import { ContactMessageResponseDto } from './dto/contact-response.dto';

/** Requests one IP may submit per hour before it is throttled. */
const CONTACT_RATE_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 };

@ApiTags('Public')
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit({
    ...CONTACT_RATE_LIMIT,
    message: 'Too many requests. Please try again later.',
  })
  @ApiOperation({
    summary: 'Submit the public contact-us form',
    description:
      'CC-05 — unauthenticated: no Authorization header, and none is ' +
      'accepted. Because it is public it is rate-limited to ' +
      `${CONTACT_RATE_LIMIT.limit} submissions per IP per hour so it cannot ` +
      'be used as a spam relay; over that it returns 429.\n\n' +
      'The submission is stored and the sales inbox is emailed ' +
      '(CONTACT_INBOX_EMAIL). A mail failure does not fail the request — the ' +
      'enquiry is already recorded.',
  })
  @ApiCreatedResponse({ type: ContactMessageResponseDto })
  @ApiBadRequestResponse({
    description:
      'Validation failed — fullName under 2 chars, malformed email, phone ' +
      'outside 7-20 chars or containing anything but digits and + - ( ), or ' +
      'message under 10 chars.',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Rate limit exceeded: `{ "message": "Too many requests. Please try ' +
      'again later.", "statusCode": 429 }`',
  })
  async submit(
    @Body() dto: CreateContactMessageDto,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ContactMessageResponseDto> {
    return this.contactService.submit(dto, {
      ipAddress: ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
