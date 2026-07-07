/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MAIN_WIRE } from "@desktop/main-channels";
import type {
  MainEvent,
  MainEventChannel,
  MainEventMap,
  MainReply,
  MainRequest,
  MainRequestChannel,
  MainRequestMap,
} from "@desktop/main-channels";
import { CLI_CHANNELS, CLI_WIRE } from "@diffusionstudio/cli/channels";
import type {
  CliReply,
  CliRequest,
  CliRequestChannel,
  CliRequestMap,
} from "@diffusionstudio/cli/channels";

type EventHandler<C extends MainEventChannel> = (data: MainEventMap[C]) => void;

type CliHandler<C extends CliRequestChannel> = (
  data: CliRequestMap[C]["request"],
) => CliRequestMap[C]["response"] | Promise<CliRequestMap[C]["response"]>;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

// Renderer↔main bridge. Symmetric with cliBridge: `handle` registers a
// single-subscriber receiver for inbound channels (events from main); `call`
// sends a request to main and awaits the reply.
class MainBridge {
  private pending = new Map<string, Pending>();
  private eventHandlers = new Map<MainEventChannel, EventHandler<MainEventChannel>>();
  private bound = false;

  private bind(): void {
    if (this.bound || !window.desktop) return;
    this.bound = true;

    window.desktop.on(MAIN_WIRE.RESPONSE, (payload) => {
      const reply = payload as MainReply;
      const entry = this.pending.get(reply.id);
      if (!entry) return;
      this.pending.delete(reply.id);
      if (reply.ok) entry.resolve(reply.data);
      else entry.reject(new Error(reply.error));
    });

    window.desktop.on(MAIN_WIRE.EVENT, (payload) => {
      const envelope = payload as MainEvent;
      const handler = this.eventHandlers.get(envelope.channel);
      if (!handler) return;
      try {
        handler(envelope.data as never);
      } catch (err) {
        console.error(`[main-bridge] handler for ${envelope.channel} threw`, err);
      }
    });
  }

  call<C extends MainRequestChannel>(
    channel: C,
    data: MainRequestMap[C]["request"],
  ): Promise<MainRequestMap[C]["response"]> {
    if (!window.desktop) {
      return Promise.reject(new Error("Main bridge unavailable: not running in desktop"));
    }
    this.bind();
    const id = crypto.randomUUID();
    const envelope: MainRequest = { id, channel, data };
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      window.desktop!.send(MAIN_WIRE.REQUEST, envelope);
    });
  }

  handle<C extends MainEventChannel>(channel: C, handler: EventHandler<C>): () => void {
    if (!window.desktop) return () => {};
    this.bind();
    const stored = handler as EventHandler<MainEventChannel>;
    this.eventHandlers.set(channel, stored);
    return () => {
      if (this.eventHandlers.get(channel) === stored) {
        this.eventHandlers.delete(channel);
      }
    };
  }
}

export const mainBridge = new MainBridge();

// CLI bridge — answers forwarded CLI requests. Main is opaque to channel names
// here; it just delivers FORWARD_REQ envelopes and routes our FORWARD_REPLY
// back to the originating socket by id. Requests for channels whose handler
// isn't registered yet are queued per-channel and drained on the first
// `handle()` call — this is how we wait for handlers that mount lazily
// (e.g. asset/project handlers that only register after sign-in) without an
// explicit ready signal.
class CliBridge {
  private handlers = new Map<CliRequestChannel, CliHandler<CliRequestChannel>>();
  private queue = new Map<CliRequestChannel, CliRequest[]>();

  constructor() {
    // Built-in: lets `waitForCliSocket` probe the round-trip without depending
    // on any app-level handler being registered.
    this.handlers.set(CLI_CHANNELS.PING, (() => undefined) as CliHandler<CliRequestChannel>);

    // Bind eagerly so FORWARD_REQ arrivals during page bootstrap are caught
    // rather than silently dropped before any handler registers.
    if (window.desktop) {
      window.desktop.on(CLI_WIRE.FORWARD_REQ, (payload) => {
        void this.dispatch(payload as CliRequest);
      });
    }
  }

  private async dispatch(req: CliRequest): Promise<void> {
    const handler = this.handlers.get(req.channel);
    if (!handler) {
      let q = this.queue.get(req.channel);
      if (!q) {
        q = [];
        this.queue.set(req.channel, q);
      }
      q.push(req);
      return;
    }
    let reply: CliReply;
    try {
      const data = await handler(req.data as never);
      reply = { id: req.id, ok: true, data };
    } catch (err) {
      reply = { id: req.id, ok: false, error: (err as Error).message };
    }
    window.desktop?.send(CLI_WIRE.FORWARD_REPLY, reply);
  }

  handle<C extends CliRequestChannel>(channel: C, handler: CliHandler<C>): () => void {
    if (!window.desktop) return () => {};
    const stored = handler as unknown as CliHandler<CliRequestChannel>;
    this.handlers.set(channel, stored);
    const queued = this.queue.get(channel);
    if (queued) {
      this.queue.delete(channel);
      for (const req of queued) void this.dispatch(req);
    }
    return () => {
      if (this.handlers.get(channel) === stored) {
        this.handlers.delete(channel);
      }
    };
  }
}

export const cliBridge = new CliBridge();
