// Copyright © 2021 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { EventStreamReply } from '../event-stream/event-stream.interfaces';
import { Context, RequestContext } from '../request-context/request-context.decorator';
import { BlockchainConnectorService } from './blockchain.service';
import {
  AsyncResponse,
  CheckInterfaceRequest,
  TokenApproval,
  TokenBalance,
  TokenBalanceQuery,
  TokenBurn,
  TokenMint,
  TokenPool,
  TokenPoolActivate,
  TokenPoolDeactivate,
  TokenPoolEvent,
  TokenTransfer,
} from './tokens.interfaces';
import { TokensService } from './tokens.service';

@Controller()
export class TokensController {
  constructor(private service: TokensService, private blockchain: BlockchainConnectorService) {}

  @Post('init')
  @HttpCode(204)
  @ApiOperation({ summary: 'Perform one-time initialization (if not auto-initialized)' })
  async init(@RequestContext() ctx: Context) {
    await this.service.init(ctx);
  }

  @Post('createpool')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Create a new token pool',
    description:
      'Will be followed by a websocket notification with event=token-pool and data=TokenPoolEvent',
  })
  @ApiBody({ type: TokenPool })
  @ApiResponse({ status: 200, type: TokenPoolEvent })
  @ApiResponse({ status: 202, type: AsyncResponse })
  async createPool(
    @RequestContext() ctx: Context,
    @Body() dto: TokenPool,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pool = await this.service.createPool(ctx, dto);
    if ('poolLocator' in pool) {
      res.status(HttpStatus.OK);
    } else {
      res.status(HttpStatus.ACCEPTED);
    }
    return pool;
  }

  @Post('activatepool')
  @ApiResponse({ status: 200, type: TokenPoolEvent })
  @ApiResponse({ status: 204 })
  @ApiOperation({
    summary: 'Activate a token pool to begin receiving transfer and approval events',
    description: 'Will retrigger the token-pool event for this pool as a side-effect',
  })
  @ApiBody({ type: TokenPoolActivate })
  async activatePool(
    @RequestContext() ctx: Context,
    @Body() dto: TokenPoolActivate,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pool = await this.service.activatePool(ctx, dto);
    if (pool !== undefined) {
      res.status(HttpStatus.OK);
    } else {
      res.status(HttpStatus.NO_CONTENT);
    }
    return pool;
  }

  @Post('deactivatepool')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Deactivate a token pool to delete all listeners and stop receiving events',
  })
  @ApiBody({ type: TokenPoolDeactivate })
  async deactivatePool(@RequestContext() ctx: Context, @Body() dto: TokenPoolDeactivate) {
    await this.service.deactivatePool(ctx, dto);
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
  mint(@RequestContext() ctx: Context, @Body() dto: TokenMint) {
    return this.service.mint(ctx, dto);
  }

  @Post('checkinterface')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Check which interface methods are supported by this connector',
  })
  @ApiBody({ type: CheckInterfaceRequest })
  checkInterface(@Body() dto: CheckInterfaceRequest) {
    return this.service.checkInterface(dto);
  }

  @Post('approval')
  @HttpCode(202)
  @ApiOperation({
    summary: "Approves a spender to perform token transfers on the caller's behalf",
    description: 'Will be followed by a websocket notification with event=token-approval',
  })
  @ApiBody({ type: TokenApproval })
  @ApiResponse({ status: 202, type: AsyncResponse })
  approve(@RequestContext() ctx: Context, @Body() dto: TokenApproval) {
    return this.service.approval(ctx, dto);
  }

  @Post('burn')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Burn tokens',
    description:
      'Will be followed by a websocket notification with event=token-burn and data=TokenBurnEvent',
  })
  @ApiBody({ type: TokenBurn })
  @ApiResponse({ status: 202, type: AsyncResponse })
  burn(@RequestContext() ctx: Context, @Body() dto: TokenBurn) {
    return this.service.burn(ctx, dto);
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
  transfer(@RequestContext() ctx: Context, @Body() dto: TokenTransfer) {
    return this.service.transfer(ctx, dto);
  }

  @Get('balance')
  @ApiOperation({ summary: 'Retrieve a token balance' })
  @ApiResponse({ status: 200, type: TokenBalance })
  balance(@RequestContext() ctx: Context, @Query() query: TokenBalanceQuery) {
    return this.service.balance(ctx, query);
  }

  @Get('receipt/:id')
  @ApiOperation({ summary: 'Retrieve the result of an async operation' })
  @ApiResponse({ status: 200, type: EventStreamReply })
  getReceipt(@RequestContext() ctx: Context, @Param('id') id: string) {
    return this.blockchain.getReceipt(ctx, id);
  }
}
