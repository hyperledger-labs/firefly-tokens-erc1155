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

import { ClientRequest } from 'http';
import { HttpService } from '@nestjs/axios';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { lastValueFrom } from 'rxjs';
import { EventStreamService } from '../event-stream/event-stream.service';
import { Event, EventStream, EventStreamReply } from '../event-stream/event-stream.interfaces';
import { EventStreamProxyGateway } from '../eventstream-proxy/eventstream-proxy.gateway';
import { EventListener, EventProcessor } from '../eventstream-proxy/eventstream-proxy.interfaces';
import { WebSocketMessage } from '../websocket-events/websocket-events.base';
import { basicAuth, topicName } from '../utils';
import {
  ApprovalForAllEvent,
  AsyncResponse,
  EthConnectAsyncResponse,
  EthConnectReturn,
  TokenApproval,
  TokenApprovalEvent,
  TokenBalance,
  TokenBalanceQuery,
  TokenBurn,
  TokenBurnEvent,
  TokenPoolCreationEvent,
  TokenMint,
  TokenMintEvent,
  TokenPool,
  TokenPoolActivate,
  TokenPoolEvent,
  TokenTransfer,
  TokenTransferEvent,
  TokenType,
  TransferBatchEvent,
  TransferSingleEvent,
  InitRequest,
} from './tokens.interfaces';
import {
  decodeHex,
  encodeHex,
  encodeHexIDForURI,
  isFungible,
  packPoolLocator,
  packStreamName,
  packSubscriptionName,
  packTokenId,
  unpackPoolLocator,
  unpackSubscriptionName,
  unpackTokenId,
} from './tokens.util';

const TOKEN_STANDARD = 'ERC1155';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const BASE_SUBSCRIPTION_NAME = 'base';

const tokenCreateEvent = 'TokenPoolCreation';
const tokenCreateEventSignatureOld = 'TokenCreate(address,uint256,bytes)';
const tokenCreateEventSignature = 'TokenPoolCreation(address,uint256,bytes)';
const transferSingleEvent = 'TransferSingle';
const transferSingleEventSignature = 'TransferSingle(address,address,address,uint256,uint256)';
const transferBatchEvent = 'TransferBatch';
const transferBatchEventSignature = 'TransferBatch(address,address,address,uint256[],uint256[])';
const approvalForAllEvent = 'ApprovalForAll';
const approvalForAllEventSignature = 'ApprovalForAll(address,address,bool)';

const ALL_SUBSCRIBED_EVENTS = [
  tokenCreateEvent,
  transferSingleEvent,
  transferBatchEvent,
  approvalForAllEvent,
];

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  baseUrl: string;
  instancePath: string;
  instanceUrl: string;
  topicPrefix: string;
  ethShortPrefix: string;
  stream = new Map<string, EventStream>();
  username: string;
  password: string;

  constructor(
    private http: HttpService,
    private eventstream: EventStreamService,
    private proxy: EventStreamProxyGateway,
  ) {}

  configure(
    baseUrl: string,
    instancePath: string,
    topicPrefix: string,
    ethShortPrefix: string,
    username: string,
    password: string,
  ) {
    this.baseUrl = baseUrl;
    this.instancePath = instancePath;
    this.instanceUrl = baseUrl + instancePath;
    this.topicPrefix = topicPrefix;
    this.ethShortPrefix = ethShortPrefix;
    this.username = username;
    this.password = password;
    this.proxy.addListener(new TokenListener(this));
  }

  /**
   * One-time initialization of event stream and base subscription.
   */
  async init(dto: InitRequest) {
    await this.migrationCheck(dto.namespace);
    const topic = topicName(this.topicPrefix, dto.namespace);
    const stream = await this.getStream(topic);
    this.stream.set(topic, stream);
    this.proxy.init(stream.websocket.topic);
    await this.eventstream.getOrCreateSubscription(
      this.instancePath,
      stream.id,
      tokenCreateEvent,
      packSubscriptionName(topic, this.instancePath, BASE_SUBSCRIPTION_NAME, tokenCreateEvent),
    );
  }

  private async getStream(topic: string) {
    const stream = this.stream.get(topic);
    if (stream !== undefined) {
      return stream;
    } else {
      const name = packStreamName(topic, this.instancePath);
      const stream = await this.eventstream.createOrUpdateStream(name, topic);
      this.stream.set(topic, stream);
      return stream;
    }
  }

  /**
   * Check for existing event streams and subscriptions that don't match the current
   * expected format (ie incorrect names, missing event subscriptions).
   *
   * Log a warning if any potential issues are flagged. User may need to delete
   * subscriptions manually and reactivate the pool directly.
   */
  async migrationCheck(namespace?: string) {
    const topic = topicName(this.topicPrefix, namespace);
    const name = packStreamName(topic, this.instancePath);
    const streams = await this.eventstream.getStreams();
    let existingStream = streams.find(s => s.name === name);
    if (existingStream === undefined) {
      // Look for the old stream names (topic alone, or topic without namespace)
      existingStream = streams.find(s => s.name === this.topicPrefix);
      if (existingStream !== undefined) {
        this.logger.warn(
          `Old event stream found with name ${existingStream.name}. ` +
            `The connector will continue to use this stream, but it is recommended ` +
            `to create a new stream with the name ${name}.`,
        );
      }
      const oldName = packStreamName(this.topicPrefix, this.instancePath);
      existingStream = streams.find(s => s.name === oldName);
      if (existingStream !== undefined) {
        this.logger.warn(
          `Old event stream found with name ${existingStream.name}. ` +
            `The connector will continue to use this stream, but it is recommended ` +
            `to create a new stream with the name ${name}.`,
        );
      } else {
        // No existing streams matching any known pattern
        return false;
      }
    }
    this.stream.set(topic, existingStream);

    const allSubscriptions = await this.eventstream.getSubscriptions();
    const baseSubscription = packSubscriptionName(
      topic,
      this.instancePath,
      BASE_SUBSCRIPTION_NAME,
      tokenCreateEvent,
    );
    const streamId = existingStream.id;
    const subscriptions = allSubscriptions.filter(
      s => s.stream === streamId && s.name !== baseSubscription,
    );
    if (subscriptions.length === 0) {
      return false;
    }

    const foundEvents = new Map<string, string[]>();
    for (const sub of subscriptions) {
      const parts = unpackSubscriptionName(sub.name);
      if (parts.poolLocator === undefined || parts.event === undefined) {
        this.logger.warn(
          `Non-parseable subscription names found in event stream ${existingStream.name}.` +
            `It is recommended to delete all subscriptions and activate all pools again.`,
        );
        return true;
      }
      const existing = foundEvents.get(parts.poolLocator);
      if (existing !== undefined) {
        existing.push(parts.event);
      } else {
        foundEvents.set(parts.poolLocator, [parts.event]);
      }
    }

    // Expect to have found subscriptions for each of the events.
    for (const [poolLocator, events] of foundEvents) {
      if (
        ALL_SUBSCRIBED_EVENTS.length !== events.length ||
        !ALL_SUBSCRIBED_EVENTS.every(event => events.includes(event))
      ) {
        this.logger.warn(
          `Event stream subscriptions for pool ${poolLocator} do not include all expected events ` +
            `(${ALL_SUBSCRIBED_EVENTS}). Events may not be properly delivered to this pool. ` +
            `It is recommended to delete its subscriptions and activate the pool again.`,
        );
        return true;
      }
    }
    return false;
  }

  private postOptions(signer: string, requestId?: string) {
    const from = `${this.ethShortPrefix}-from`;
    const sync = `${this.ethShortPrefix}-sync`;
    const id = `${this.ethShortPrefix}-id`;

    const requestOptions: AxiosRequestConfig = {
      params: {
        [from]: signer,
        [sync]: 'false',
        [id]: requestId,
      },
      ...basicAuth(this.username, this.password),
    };

    return requestOptions;
  }

  private async wrapError<T>(response: Promise<AxiosResponse<T>>) {
    return response.catch(err => {
      if (axios.isAxiosError(err)) {
        const request: ClientRequest | undefined = err.request;
        const response: AxiosResponse | undefined = err.response;
        const errorMessage = response?.data?.error ?? err.message;
        this.logger.warn(
          `${request?.path} <-- HTTP ${response?.status} ${response?.statusText}: ${errorMessage}`,
        );
        throw new InternalServerErrorException(errorMessage);
      }
      throw err;
    });
  }

  async query(path: string, params?: any) {
    const response = await this.wrapError(
      lastValueFrom(
        this.http.get<EthConnectReturn>(`${this.instanceUrl}${path}`, {
          params,
          ...basicAuth(this.username, this.password),
        }),
      ),
    );
    return response.data;
  }

  async invoke(path: string, from: string, id?: string, body?: any) {
    const response = await this.wrapError(
      lastValueFrom(
        this.http.post<EthConnectAsyncResponse>(
          `${this.instanceUrl}${path}`,
          body,
          this.postOptions(from, id),
        ),
      ),
    );
    return response.data;
  }

  async getReceipt(id: string): Promise<EventStreamReply> {
    const response = await this.wrapError(
      lastValueFrom(
        this.http.get<EventStreamReply>(`${this.baseUrl}/reply/${id}`, {
          validateStatus: status => status < 300 || status === 404,
          ...basicAuth(this.username, this.password),
        }),
      ),
    );
    if (response.status === 404) {
      throw new NotFoundException();
    }
    return response.data;
  }

  async createPool(dto: TokenPool): Promise<AsyncResponse> {
    const response = await this.invoke('/create', dto.signer, dto.requestId, {
      is_fungible: dto.type === TokenType.FUNGIBLE,
      data: encodeHex(dto.data ?? ''),
    });
    return { id: response.id };
  }

  async activatePool(dto: TokenPoolActivate) {
    const topic = topicName(this.topicPrefix, dto.namespace);
    const stream = await this.getStream(topic);
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    await Promise.all([
      this.eventstream.getOrCreateSubscription(
        this.instancePath,
        stream.id,
        tokenCreateEvent,
        packSubscriptionName(topic, this.instancePath, dto.poolLocator, tokenCreateEvent),
        poolLocator.blockNumber ?? '0',
      ),
      this.eventstream.getOrCreateSubscription(
        this.instancePath,
        stream.id,
        transferSingleEvent,
        packSubscriptionName(topic, this.instancePath, dto.poolLocator, transferSingleEvent),
        poolLocator.blockNumber ?? '0',
      ),
      this.eventstream.getOrCreateSubscription(
        this.instancePath,
        stream.id,
        transferBatchEvent,
        packSubscriptionName(topic, this.instancePath, dto.poolLocator, transferBatchEvent),
        poolLocator.blockNumber ?? '0',
      ),
      this.eventstream.getOrCreateSubscription(
        this.instancePath,
        stream.id,
        approvalForAllEvent,
        packSubscriptionName(topic, this.instancePath, dto.poolLocator, approvalForAllEvent),
        // Block number is 0 because it is important to receive all approval events,
        // so existing approvals will be reflected in the newly created pool
        '0',
      ),
    ]);
  }

  async mint(dto: TokenMint): Promise<AsyncResponse> {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    const typeId = packTokenId(poolLocator.poolId);
    if (isFungible(poolLocator.poolId)) {
      const response = await this.invoke('/mintFungible', dto.signer, dto.requestId, {
        type_id: typeId,
        to: [dto.to],
        amounts: [dto.amount],
        data: encodeHex(dto.data ?? ''),
      });
      return { id: response.id };
    } else {
      // In the case of a non-fungible token:
      // - We parse the value as a whole integer count of NFTs to mint
      // - We require the number to be small enough to express as a JS number (we're packing into an array)
      const to: string[] = [];
      const amount = parseInt(dto.amount);
      for (let i = 0; i < amount; i++) {
        to.push(dto.to);
      }

      const response = await this.invoke('/mintNonFungible', dto.signer, dto.requestId, {
        type_id: typeId,
        to,
        data: encodeHex(dto.data ?? ''),
      });
      return { id: response.id };
    }
  }

  async approval(dto: TokenApproval): Promise<AsyncResponse> {
    const response = await this.invoke('/setApprovalForAllWithData', dto.signer, dto.requestId, {
      operator: dto.operator,
      approved: dto.approved,
      data: encodeHex(dto.data ?? ''),
    });
    return { id: response.id };
  }

  async transfer(dto: TokenTransfer): Promise<AsyncResponse> {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    const response = await this.invoke('/safeTransferFrom', dto.signer, dto.requestId, {
      from: dto.from,
      to: dto.to,
      id: packTokenId(poolLocator.poolId, dto.tokenIndex),
      amount: dto.amount,
      data: encodeHex(dto.data ?? ''),
    });
    return { id: response.id };
  }

  async burn(dto: TokenBurn): Promise<AsyncResponse> {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    const response = await this.invoke('/burn', dto.signer, dto.requestId, {
      from: dto.from,
      id: packTokenId(poolLocator.poolId, dto.tokenIndex),
      amount: dto.amount,
      data: encodeHex(dto.data ?? ''),
    });
    return { id: response.id };
  }

  async balance(dto: TokenBalanceQuery): Promise<TokenBalance> {
    const poolLocator = unpackPoolLocator(dto.poolLocator);
    const response = await this.query('/balanceOf', {
      account: dto.account,
      id: packTokenId(poolLocator.poolId, dto.tokenIndex),
    });
    return { balance: response.output };
  }
}

class TokenListener implements EventListener {
  private readonly logger = new Logger(TokenListener.name);

  private uriPattern: string | undefined;

  constructor(private readonly service: TokensService) {}

  async onEvent(subName: string, event: Event, process: EventProcessor) {
    switch (event.signature) {
      case tokenCreateEventSignatureOld:
      case tokenCreateEventSignature:
        process(this.transformTokenPoolCreationEvent(subName, event));
        break;
      case transferSingleEventSignature:
        process(await this.transformTransferSingleEvent(subName, event));
        break;
      case approvalForAllEventSignature:
        process(this.transformApprovalForAllEvent(subName, event));
        break;
      case transferBatchEventSignature:
        for (const msg of await this.transformTransferBatchEvent(subName, event)) {
          process(msg);
        }
        break;
      default:
        this.logger.error(`Unknown event signature: ${event.signature}`);
        return undefined;
    }
  }

  /**
   * Generate an event ID in the recognized FireFly format for Ethereum
   * (zero-padded block number, transaction index, and log index)
   */
  private formatBlockchainEventId(event: Event) {
    const blockNumber = event.blockNumber ?? '0';
    const txIndex = BigInt(event.transactionIndex).toString(10);
    const logIndex = event.logIndex ?? '0';
    return [
      blockNumber.padStart(12, '0'),
      txIndex.padStart(6, '0'),
      logIndex.padStart(6, '0'),
    ].join('/');
  }

  private stripParamsFromSignature(signature: string) {
    return signature.substring(0, signature.indexOf('('));
  }

  private transformTokenPoolCreationEvent(
    subName: string,
    event: TokenPoolCreationEvent,
  ): WebSocketMessage | undefined {
    const { data: output } = event;
    const unpackedId = unpackTokenId(output.type_id);
    const unpackedSub = unpackSubscriptionName(subName);
    const decodedData = decodeHex(output.data ?? '');

    if (unpackedSub.poolLocator === undefined) {
      // should not happen
      return undefined;
    }

    const poolLocator = unpackPoolLocator(unpackedSub.poolLocator);
    if (poolLocator.poolId !== BASE_SUBSCRIPTION_NAME && poolLocator.poolId !== unpackedId.poolId) {
      return undefined;
    }

    return {
      event: 'token-pool',
      data: <TokenPoolEvent>{
        standard: TOKEN_STANDARD,
        poolLocator: packPoolLocator(unpackedId.poolId, event.blockNumber),
        type: unpackedId.isFungible ? TokenType.FUNGIBLE : TokenType.NONFUNGIBLE,
        signer: output.operator,
        data: decodedData,
        info: {
          address: event.address,
          typeId: '0x' + encodeHexIDForURI(output.type_id),
        },
        blockchain: {
          id: this.formatBlockchainEventId(event),
          name: this.stripParamsFromSignature(event.signature),
          location: 'address=' + event.address,
          signature: event.signature,
          timestamp: event.timestamp,
          output,
          info: {
            blockNumber: event.blockNumber,
            transactionIndex: event.transactionIndex,
            transactionHash: event.transactionHash,
            logIndex: event.logIndex,
            address: event.address,
            signature: event.signature,
          },
        },
      },
    };
  }

  private async transformTransferSingleEvent(
    subName: string,
    event: TransferSingleEvent,
    eventIndex?: number,
  ): Promise<WebSocketMessage | undefined> {
    const { data: output } = event;
    const unpackedId = unpackTokenId(output.id);
    const unpackedSub = unpackSubscriptionName(subName);
    const decodedData = decodeHex(event.inputArgs?.data ?? '');

    if (unpackedSub.poolLocator === undefined) {
      // should not happen
      return undefined;
    }

    const poolLocator = unpackPoolLocator(unpackedSub.poolLocator);
    if (poolLocator.poolId !== unpackedId.poolId) {
      // this transfer is not from the subscribed pool
      return undefined;
    }
    if (output.from === ZERO_ADDRESS && output.to === ZERO_ADDRESS) {
      // should not happen
      return undefined;
    }

    const uri = unpackedId.isFungible ? undefined : await this.getTokenUri(output.id);
    const eventId = this.formatBlockchainEventId(event);
    const transferId =
      eventIndex === undefined ? eventId : eventId + '/' + eventIndex.toString(10).padStart(6, '0');

    const commonData = <TokenTransferEvent>{
      id: transferId,
      poolLocator: unpackedSub.poolLocator,
      tokenIndex: unpackedId.tokenIndex,
      uri,
      amount: output.value,
      signer: output.operator,
      data: decodedData,
      blockchain: {
        id: eventId,
        name: this.stripParamsFromSignature(event.signature),
        location: 'address=' + event.address,
        signature: event.signature,
        timestamp: event.timestamp,
        output,
        info: {
          blockNumber: event.blockNumber,
          transactionIndex: event.transactionIndex,
          transactionHash: event.transactionHash,
          logIndex: event.logIndex,
          address: event.address,
          signature: event.signature,
        },
      },
    };

    if (output.from === ZERO_ADDRESS) {
      return {
        event: 'token-mint',
        data: <TokenMintEvent>{ ...commonData, to: output.to },
      };
    } else if (output.to === ZERO_ADDRESS) {
      return {
        event: 'token-burn',
        data: <TokenBurnEvent>{ ...commonData, from: output.from },
      };
    } else {
      return {
        event: 'token-transfer',
        data: <TokenTransferEvent>{ ...commonData, from: output.from, to: output.to },
      };
    }
  }

  private async transformTransferBatchEvent(
    subName: string,
    event: TransferBatchEvent,
  ): Promise<WebSocketMessage[]> {
    const messages: WebSocketMessage[] = [];
    for (let i = 0; i < event.data.ids.length; i++) {
      const message = await this.transformTransferSingleEvent(
        subName,
        {
          ...event,
          data: {
            from: event.data.from,
            to: event.data.to,
            operator: event.data.operator,
            id: event.data.ids[i],
            value: event.data.values[i],
          },
        },
        i,
      );
      if (message !== undefined) {
        messages.push(message);
      }
    }
    return messages;
  }

  private transformApprovalForAllEvent(
    subName: string,
    event: ApprovalForAllEvent,
  ): WebSocketMessage | undefined {
    const { data: output } = event;
    const unpackedSub = unpackSubscriptionName(subName);
    const decodedData = decodeHex(event.inputArgs?.data ?? '');

    if (unpackedSub.poolLocator === undefined) {
      // should not happen
      return undefined;
    }
    const poolLocator = unpackPoolLocator(unpackedSub.poolLocator);

    // One event may apply across multiple pools
    // Include the poolId to generate a unique approvalId per pool
    const eventId = this.formatBlockchainEventId(event);
    const approvalId = eventId + '/' + poolLocator.poolId;

    return {
      event: 'token-approval',
      data: <TokenApprovalEvent>{
        id: approvalId,
        subject: `${output.account}:${output.operator}`,
        poolLocator: unpackedSub.poolLocator,
        operator: output.operator,
        approved: output.approved,
        signer: output.account,
        data: decodedData,
        blockchain: {
          id: eventId,
          name: this.stripParamsFromSignature(event.signature),
          location: 'address=' + event.address,
          signature: event.signature,
          timestamp: event.timestamp,
          output,
          info: {
            blockNumber: event.blockNumber,
            transactionIndex: event.transactionIndex,
            transactionHash: event.transactionHash,
            logIndex: event.logIndex,
            address: event.address,
            signature: event.signature,
          },
        },
      },
    };
  }

  private async getTokenUri(id: string) {
    if (this.uriPattern === undefined) {
      // Fetch and cache the URI pattern (assume it is the same for all tokens)
      try {
        const response = await this.service.query('/uri?input=0');
        this.uriPattern = response.output;
      } catch (err) {
        return '';
      }
    }
    return this.uriPattern.replace('{id}', encodeHexIDForURI(id));
  }
}
