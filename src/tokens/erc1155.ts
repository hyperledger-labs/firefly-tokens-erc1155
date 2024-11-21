// Copyright © 2024 Kaleido, Inc.
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

import { BadRequestException } from '@nestjs/common';
import {
  MethodSignature,
  TokenOperation,
  TokenApproval,
  TokenBurn,
  TokenMint,
  TokenTransfer,
  PoolLocator,
} from './tokens.interfaces';
import { encodeHex, computeTokenId } from './tokens.util';

// Methods defined as part of the ERC1155 standard

export const BalanceOf = {
  name: 'balanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    {
      internalType: 'address',
      name: 'account',
      type: 'address',
    },
    {
      internalType: 'uint256',
      name: 'id',
      type: 'uint256',
    },
  ],
  outputs: [
    {
      internalType: 'uint256',
      name: '',
      type: 'uint256',
    },
  ],
};

// Although methods below are "optional" in the standard, they are
// currently required by this connector.

export const URI = {
  name: 'uri',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    {
      internalType: 'uint256',
      name: 'id',
      type: 'uint256',
    },
  ],
  outputs: [
    {
      internalType: 'string',
      name: '',
      type: 'string',
    },
  ],
};

// Events defined as part of the ERC1155 standard

export const TransferSingle = {
  name: 'TransferSingle',
  type: 'event',
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: 'address',
      name: 'operator',
      type: 'address',
    },
    {
      indexed: true,
      internalType: 'address',
      name: 'from',
      type: 'address',
    },
    {
      indexed: true,
      internalType: 'address',
      name: 'to',
      type: 'address',
    },
    {
      indexed: false,
      internalType: 'uint256',
      name: 'id',
      type: 'uint256',
    },
    {
      indexed: false,
      internalType: 'uint256',
      name: 'value',
      type: 'uint256',
    },
  ],
};

export const TransferBatch = {
  name: 'TransferBatch',
  type: 'event',
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: 'address',
      name: 'operator',
      type: 'address',
    },
    {
      indexed: true,
      internalType: 'address',
      name: 'from',
      type: 'address',
    },
    {
      indexed: true,
      internalType: 'address',
      name: 'to',
      type: 'address',
    },
    {
      indexed: false,
      internalType: 'uint256[]',
      name: 'ids',
      type: 'uint256[]',
    },
    {
      indexed: false,
      internalType: 'uint256[]',
      name: 'values',
      type: 'uint256[]',
    },
  ],
};

export const ApprovalForAll = {
  name: 'ApprovalForAll',
  type: 'event',
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: 'address',
      name: 'account',
      type: 'address',
    },
    {
      indexed: true,
      internalType: 'address',
      name: 'operator',
      type: 'address',
    },
    {
      indexed: false,
      internalType: 'bool',
      name: 'approved',
      type: 'bool',
    },
  ],
};

export const AllEvents = [TransferSingle, TransferBatch, ApprovalForAll];

// Methods which have many possible forms
// These may include extensions defined by FireFly, extensions defined by
// OpenZeppelin, and methods that are part of the base standard.
// Each operation type is a prioritized list of methods to be used if defined.

export const DynamicMethods: Record<TokenOperation, MethodSignature[]> = {
  approval: [
    {
      // Source: FireFly extension
      name: 'setApprovalForAllWithData',
      inputs: [{ type: 'address' }, { type: 'bool' }, { type: 'bytes' }],
      map: (poolLocator: PoolLocator, dto: TokenApproval) => {
        return [dto.operator, dto.approved, encodeHex(dto.data ?? '')];
      },
    },
    {
      // Source: base standard
      name: 'setApprovalForAll',
      inputs: [{ type: 'address' }, { type: 'bool' }],
      map: (poolLocator: PoolLocator, dto: TokenApproval) => {
        return [dto.operator, dto.approved];
      },
    },
  ],

  burn: [
    {
      // Source: FireFly extension
      name: 'burn',
      inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }],
      map: (poolLocator: PoolLocator, dto: TokenBurn) => {
        return [
          dto.from,
          computeTokenId(poolLocator, dto.tokenIndex),
          dto.amount,
          encodeHex(dto.data ?? ''),
        ];
      },
    },
    {
      // Source: OpenZeppelin extension
      name: 'burn',
      inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
      map: (poolLocator: PoolLocator, dto: TokenBurn) => {
        return [dto.from, computeTokenId(poolLocator, dto.tokenIndex), dto.amount];
      },
    },
  ],

  mint: [
    {
      // Source: FireFly extension
      name: 'mintFungible',
      inputs: [
        { type: 'uint256' },
        { type: 'address[]' },
        { type: 'uint256[]' },
        { type: 'bytes' },
      ],
      map: (poolLocator: PoolLocator, dto: TokenMint) => {
        if (poolLocator.isFungible) {
          return [computeTokenId(poolLocator), [dto.to], [dto.amount], encodeHex(dto.data ?? '')];
        }
        return undefined;
      },
    },
    {
      // Source: FireFly extension
      name: 'mintNonFungibleWithURI',
      inputs: [{ type: 'uint256' }, { type: 'address[]' }, { type: 'bytes' }, { type: 'string' }],
      map: (poolLocator: PoolLocator, dto: TokenMint) => {
        if (!poolLocator.isFungible) {
          // In the case of a non-fungible token, we parse the value as a whole integer count of NFTs to mint
          verifyNoIndex(dto);
          const to: string[] = [];
          const amount = BigInt(dto.amount);
          for (let i = BigInt(0); i < amount; i++) {
            to.push(dto.to);
          }
          return [computeTokenId(poolLocator), to, encodeHex(dto.data ?? ''), dto.uri ?? ''];
        }
        return undefined;
      },
    },
    {
      // Source: FireFly extension
      name: 'mintNonFungible',
      inputs: [{ type: 'uint256' }, { type: 'address[]' }, { type: 'bytes' }],
      map: (poolLocator: PoolLocator, dto: TokenMint) => {
        if (!poolLocator.isFungible) {
          // In the case of a non-fungible token, we parse the value as a whole integer count of NFTs to mint
          verifyNoIndex(dto);
          const to: string[] = [];
          const amount = BigInt(dto.amount);
          for (let i = BigInt(0); i < amount; i++) {
            to.push(dto.to);
          }
          return [computeTokenId(poolLocator), to, encodeHex(dto.data ?? '')];
        }
        return undefined;
      },
    },
    {
      // Option with token index and single receiver
      name: 'mintNonFungibleWithURI',
      inputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes' }, { type: 'string' }],
      map: (poolLocator: PoolLocator, dto: TokenMint) => {
        if (!poolLocator.isFungible) {
          const amount = BigInt(dto.amount);
          if (amount !== BigInt(1)) {
            throw new BadRequestException('Amount for nonfungible tokens must be 1');
          }
          return [
            computeTokenId(poolLocator),
            dto.tokenIndex,
            dto.to,
            encodeHex(dto.data ?? ''),
            dto.uri ?? '',
          ];
        }
        return undefined;
      },
    },
    {
      // Option with token index and single receiver
      name: 'mintNonFungible',
      inputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes' }],
      map: (poolLocator: PoolLocator, dto: TokenMint) => {
        if (!poolLocator.isFungible) {
          // In the case of a non-fungible token, we parse the value as a whole integer count of NFTs to mint
          const amount = parseInt(dto.amount);
          if (amount !== 1) {
            throw new BadRequestException('Amount for nonfungible tokens must be 1');
          }
            return [computeTokenId(poolLocator), dto.tokenIndex, dto.to, encodeHex(dto.data ?? '')];
        }
        return undefined;
      },
    },
    {
      // Source: OpenZeppelin extension
      name: 'mint',
      inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }],
      map: (poolLocator: PoolLocator, dto: TokenMint) => {
        if (poolLocator.isFungible) {
          return [dto.to, computeTokenId(poolLocator), dto.amount, encodeHex(dto.data ?? '')];
        } else {
          verifyHasIndex(dto);
          return [
            dto.to,
            computeTokenId(poolLocator, dto.tokenIndex),
            dto.amount,
            encodeHex(dto.data ?? ''),
          ];
        }
      },
    },
  ],

  transfer: [
    {
      // Source: base standard
      name: 'safeTransferFrom',
      inputs: [
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'bytes' },
      ],
      map: (poolLocator: PoolLocator, dto: TokenTransfer) => {
        return [
          dto.from,
          dto.to,
          computeTokenId(poolLocator, dto.tokenIndex),
          dto.amount,
          encodeHex(dto.data ?? ''),
        ];
      },
    },
  ],
};

function verifyHasIndex(dto: TokenMint) {
  if (dto.tokenIndex === undefined) {
    throw new BadRequestException('Setting token index is required by this contract');
  }
}

function verifyNoIndex(dto: TokenMint) {
  if (dto.tokenIndex !== undefined) {
    throw new BadRequestException('Setting token index is not supported by this contract');
  }
}
