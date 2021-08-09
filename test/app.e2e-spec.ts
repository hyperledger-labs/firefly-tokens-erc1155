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

import { Test, TestingModule } from '@nestjs/testing';
import { HttpService, INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { WsAdapter } from '@nestjs/platform-ws';
import { TokensService } from '../src/tokens/tokens.service';
import {
  EthConnectAsyncResponse,
  EthConnectReturn,
  TokenBalance,
  TokenBalanceQuery,
  TokenMint,
  TokenPool,
  TokenTransfer,
  TokenType,
} from '../src/tokens/tokens.interfaces';
import { AppModule } from './../src/app.module';

const BASE_URL = 'http://eth';
const INSTANCE_URL = `${BASE_URL}/tokens`;
const IDENTITY = '0x1';
const OPTIONS = {
  params: {
    'fly-from': IDENTITY,
    'fly-sync': 'false',
  },
};

class FakeObservable<T> {
  constructor(public data: T) {}

  toPromise() {
    return this;
  }
}

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<typeof request>;
  let http: {
    get: ReturnType<typeof jest.fn>;
    post: ReturnType<typeof jest.fn>;
  };

  beforeEach(async () => {
    http = {
      get: jest.fn(),
      post: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HttpService)
      .useValue(http)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    app.get(TokensService).configure(BASE_URL, INSTANCE_URL, IDENTITY);

    server = request(app.getHttpServer());
  });

  afterEach(async () => {
    await app.close();
  });

  it('Create fungible pool', async () => {
    const request: TokenPool = {
      type: TokenType.FUNGIBLE,
      namespace: 'testns',
      name: 'token1',
      client_id: '1',
    };
    const response: EthConnectAsyncResponse = {
      id: '1',
      sent: true,
    };

    http.post = jest.fn(() => new FakeObservable(response));

    await server.post('/pool').send(request).expect(202).expect({ id: '1' });

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      `${INSTANCE_URL}/create`,
      {
        uri: 'fly://erc1155/testns/token1/1',
        is_fungible: true,
      },
      OPTIONS,
    );
  });

  it('Create non-fungible pool', async () => {
    const request: TokenPool = {
      type: TokenType.NONFUNGIBLE,
      namespace: 'testns',
      name: 'token1',
      client_id: '1',
    };
    const response: EthConnectAsyncResponse = {
      id: '1',
      sent: true,
    };

    http.post = jest.fn(() => new FakeObservable(response));

    await server.post('/pool').send(request).expect(202).expect({ id: '1' });

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      `${INSTANCE_URL}/create`,
      {
        uri: 'fly://erc1155/testns/token1/1',
        is_fungible: false,
      },
      OPTIONS,
    );
  });

  it('Mint fungible token', async () => {
    const request: TokenMint = {
      pool_id: 'F1',
      to: '1',
      amount: 2,
    };
    const response: EthConnectAsyncResponse = {
      id: '1',
      sent: true,
    };

    http.post = jest.fn(() => new FakeObservable(response));

    await server.post('/mint').send(request).expect(202).expect({ id: '1' });

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      `${INSTANCE_URL}/mintFungible`,
      {
        type_id: '340282366920938463463374607431768211456',
        to: ['1'],
        amounts: [2],
        data: [0],
      },
      OPTIONS,
    );
  });

  it('Mint non-fungible token', async () => {
    const request: TokenMint = {
      pool_id: 'N1',
      to: '1',
      amount: 2,
    };
    const response: EthConnectAsyncResponse = {
      id: '1',
      sent: true,
    };

    http.post = jest.fn(() => new FakeObservable(response));

    await server.post('/mint').send(request).expect(202).expect({ id: '1' });

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      `${INSTANCE_URL}/mintNonFungible`,
      {
        type_id: '57896044618658097711785492504343953926975274699741220483192166611388333031424',
        to: ['1', '1'],
        data: [0],
      },
      OPTIONS,
    );
  });

  it('Query balance', async () => {
    const request: TokenBalanceQuery = {
      account: '1',
      pool_id: 'F1',
      token_index: '0',
    };
    const response: EthConnectReturn = {
      output: '1',
    };

    http.get = jest.fn(() => new FakeObservable(response));

    await server
      .get('/balance')
      .query(request)
      .expect(200)
      .expect(<TokenBalance>{
        balance: 1,
      });

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledWith(`${INSTANCE_URL}/balanceOf`, {
      params: {
        account: '1',
        id: '340282366920938463463374607431768211456',
      },
    });
  });

  it('Transfer token', async () => {
    const request: TokenTransfer = {
      pool_id: 'F1',
      token_index: '0',
      from: '1',
      to: '2',
      amount: 2,
    };
    const response: EthConnectAsyncResponse = {
      id: '1',
      sent: true,
    };

    http.post = jest.fn(() => new FakeObservable(response));

    await server.post('/transfer').send(request).expect(202).expect({ id: '1' });

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith(
      `${INSTANCE_URL}/safeTransferFrom`,
      {
        id: '340282366920938463463374607431768211456',
        from: '1',
        to: '2',
        amount: 2,
        data: [0],
      },
      OPTIONS,
    );
  });
});
