/// <reference types="node" />

import { EventEmitter } from 'events';

export interface CanBusOptions {
  /** CAN bus bitrate in kbps. Default: 500 */
  bitrate?: 5 | 10 | 20 | 50 | 100 | 125 | 200 | 250 | 400 | 500 | 800 | 1000;
  /** Listen-only mode — will not transmit on the bus. Default: true */
  silent?: boolean;
  /** Auto-reconnect on unexpected disconnect. Default: true */
  reconnect?: boolean;
  /** Initial reconnect delay in ms. Default: 1000 */
  retryDelay?: number;
  /** Maximum reconnect delay in ms after exponential backoff. Default: 10000 */
  retryMax?: number;
  /** Maximum reconnect attempts before giving up. 0 = try forever. Default: 0 */
  maxRetries?: number;
}

export interface CanFrame {
  /** CAN message ID */
  id: number;
  /** true = 29-bit extended frame, false = 11-bit standard frame */
  ext: boolean;
  /** true = remote frame */
  rtr: boolean;
  /** Data length code (0–8) */
  dlc: number;
  /** Payload bytes */
  data: Buffer;
}

export interface ReconnectInfo {
  /** Current attempt number */
  attempt: number;
  /** Delay in ms before this attempt */
  delay: number;
  /** Maximum attempts, or null if unlimited */
  max: number | null;
}

export declare interface CanBus {
  on(event: 'open',        listener: () => void): this;
  on(event: 'close',       listener: () => void): this;
  on(event: 'disconnect',  listener: () => void): this;
  on(event: 'reconnected', listener: () => void): this;
  on(event: 'reconnecting', listener: (info: ReconnectInfo) => void): this;
  on(event: 'error',       listener: (err: Error) => void): this;
  on(event: 'frame',       listener: (frame: CanFrame) => void): this;
}

export declare class CanBus extends EventEmitter {
  constructor(port: string, options?: CanBusOptions);

  /** Opens the serial port and initializes the adapter. */
  open(): void;

  /** Closes the serial port. Suppresses automatic reconnect. */
  close(): void;
}

export default CanBus;
