import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { EventStreamReply } from '../event-stream/event-stream.interfaces';
import {
  AsyncResponse,
  TokenBalance,
  TokenBalanceQuery,
  TokenMint,
  TokenPool,
  TokenTransfer,
} from './tokens.interfaces';
import { TokensService } from './tokens.service';

@Controller()
export class TokensController {
  constructor(private readonly service: TokensService) {}

  @Post('pool')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Create a new token pool',
    description:
      'Will be followed by a websocket notification with event=token-pool and data=TokenPoolEvent',
  })
  @ApiBody({ type: TokenPool })
  @ApiResponse({ status: 202, type: AsyncResponse })
  createPool(@Body() dto: TokenPool) {
    return this.service.createPool(dto);
  }

  @Post('mint')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Mint new tokens',
    description:
      'Will be followed by a websocket notification with event=token-mint and data=TokenMintEvent',
  })
  @ApiBody({ type: TokenMint })
  @ApiResponse({ status: 202, type: AsyncResponse })
  mint(@Body() dto: TokenMint) {
    return this.service.mint(dto);
  }

  @Get('balance')
  @ApiOperation({ summary: 'Retrieve a token balance' })
  @ApiResponse({ status: 200, type: TokenBalance })
  balance(@Query() query: TokenBalanceQuery) {
    return this.service.balance(query);
  }

  @Post('transfer')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Transfer tokens',
    description:
      'Will be followed by a websocket notification with event=token-transfer and data=TokenTransferEvent',
  })
  @ApiBody({ type: TokenTransfer })
  @ApiResponse({ status: 202, type: AsyncResponse })
  transfer(@Body() dto: TokenTransfer) {
    return this.service.transfer(dto);
  }

  @Get('receipt/:id')
  @ApiOperation({ summary: 'Retrieve the result of an async operation' })
  @ApiResponse({ status: 200, type: EventStreamReply })
  getReceipt(@Param('id') id: string) {
    return this.service.getReceipt(id);
  }
}
