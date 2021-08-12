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

import { Injectable } from '@nestjs/common';
import { EventStreamService } from './event-stream/event-stream.service';

const SUBSCRIPTIONS = ['TokenCreate', 'TransferSingle'];

@Injectable()
export class AppService {
  private ethConnectUrl: string;
  private instanceUrl: string;
  private topic: string;

  constructor(private eventStream: EventStreamService) {}

  configure(ethConnectUrl: string, instanceUrl: string, topic: string) {
    this.ethConnectUrl = ethConnectUrl;
    this.instanceUrl = instanceUrl;
    this.topic = topic;
  }

  async init() {
    const stream = await this.eventStream.ensureEventStream(this.ethConnectUrl, this.topic);
    await this.eventStream.ensureSubscriptions(
      this.ethConnectUrl,
      this.instanceUrl,
      stream.id,
      SUBSCRIPTIONS,
    );
  }
}
