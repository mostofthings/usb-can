'use strict';

const { EventEmitter } = require('events');
const { SerialPort }   = require('serialport');

// Baud rate byte values per the CH340/CH341 protocol spec
const BITRATE_MAP = {
    1000: 0x01,
    800:  0x02,
    500:  0x03,
    400:  0x04,
    250:  0x05,
    200:  0x06,
    125:  0x07,
    100:  0x08,
    50:   0x09,
    20:   0x0A,
    10:   0x0B,
    5:    0x0C,
};

// Operation modes
const MODE_NORMAL   = 0x00;
const MODE_LOOPBACK = 0x01;
const MODE_SILENT   = 0x02; // listen-only, safest for monitoring

// Frame markers
const FRAME_START = 0xAA;
const FRAME_END   = 0x55;

class CanBus extends EventEmitter {
    /**
     * @param {string} port    - Serial port path, e.g. '/dev/ttyUSB0'
     * @param {object} opts
     * @param {number}  opts.bitrate       - CAN bitrate in kbps (default 500)
     * @param {boolean} opts.silent        - Listen-only mode (default true, safest)
     * @param {boolean} opts.reconnect     - Auto-reconnect on disconnect (default true)
     * @param {number}  opts.retryDelay    - Initial retry delay in ms (default 1000)
     * @param {number}  opts.retryMax      - Max retry delay in ms after backoff (default 10000)
     * @param {number}  opts.maxRetries    - Max attempts before giving up; 0 = forever (default 0)
     */

    #portPath;
    #bitrate;
    #silent;
    #reconnect;
    #retryDelay;
    #retryMax;
    #maxRetries;

    #port         = null;
    #buffer          = Buffer.alloc(0);
    #opened       = false;
    #closing      = false;
    #retryCount   = 0;
    #retryTimer   = null;
    #currentDelay;

    constructor(port, opts = {}) {
        super();
        this.#portPath      = port;
        this.#bitrate       = opts.bitrate    ?? 500;
        this.#silent        = opts.silent     ?? true;
        this.#reconnect     = opts.reconnect  ?? true;
        this.#retryDelay    = opts.retryDelay ?? 1000;
        this.#retryMax      = opts.retryMax   ?? 10000;
        this.#maxRetries    = opts.maxRetries ?? 0;
        this.#currentDelay  = this.#retryDelay;
    }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    open() {
        if (this.#opened) return;
        this.#closing      = false;
        this.#retryCount   = 0;
        this.#currentDelay = this.#retryDelay;
        this.#connect();
    }

    close() {
        this.#closing = true;
        if (this.#retryTimer) {
            clearTimeout(this.#retryTimer);
            this.#retryTimer = null;
        }
        if (this.#port && this.#port.isOpen) {
            this.#port.close();
        }
    }

    // ---------------------------------------------------------------------------
    // Internal connect / reconnect
    // ---------------------------------------------------------------------------

    #connect() {
        const bitrateVal = BITRATE_MAP[this.#bitrate];
        if (!bitrateVal) {
            throw new Error(`Unsupported bitrate: ${this.#bitrate}. Valid: ${Object.keys(BITRATE_MAP).join(', ')} kbps`);
        }

        // Clean up any previous port instance
        if (this.#port) {
            this.#port.removeAllListeners();
            this.#port = null;
        }
        this.#buffer = Buffer.alloc(0);

        this.#port = new SerialPort({
            path:     this.#portPath,
            baudRate: 2000000,
            autoOpen: false,
        });

        this.#port.on('error', (err) => {
            this.emit('error', err);
        });

        this.#port.on('close', () => {
            this.#opened = false;
            this.#buffer    = Buffer.alloc(0);

            if (this.#closing) {
                this.emit('close');
                return;
            }

            this.emit('disconnect');
            this.#scheduleReconnect(bitrateVal);
        });

        this.#port.on('data', (chunk) => this.#onData(chunk));

        this.#port.open((err) => {
            if (err) {
                if (this.#closing) return;
                this.emit('error', new Error(`Failed to open ${this.#portPath}: ${err.message}`));
                this.#scheduleReconnect(bitrateVal);
                return;
            }

            this.#opened       = true;
            this.#retryCount   = 0;
            this.#currentDelay = this.#retryDelay;

            this.#sendInit(bitrateVal);

            if (this.#retryCount === 0) {
                this.emit('open');
            } else {
                this.emit('reconnected');
            }
        });
    }

    #scheduleReconnect(bitrateVal) {
        if (this.#closing) return;

        this.#retryCount++;

        if (this.#maxRetries > 0 && this.#retryCount > this.#maxRetries) {
            this.emit('error', new Error(
                `[can-bus] Giving up after ${this.#maxRetries} reconnect attempts`
            ));
            this.emit('close');
            return;
        }

        this.emit('reconnecting', {
            attempt: this.#retryCount,
            delay:   this.#currentDelay,
            max:     this.#maxRetries || null,
        });

        this.#retryTimer = setTimeout(() => {
            this.#retryTimer = null;
            this.#connect();
        }, this.#currentDelay);

        // Exponential backoff capped at retryMax
        this.#currentDelay = Math.min(this.#currentDelay * 2, this.#retryMax);
    }

    // ---------------------------------------------------------------------------
    // Initialization frame
    // ---------------------------------------------------------------------------

    #sendInit(bitrateVal) {
        // 20-byte init frame per CH340/CH341 protocol spec
        // [0xAA, 0x55, 0x12, baudrate, frameType, filter(4), mask(4), mode, 0x01, zeros(4), checksum]
        const frame = Buffer.alloc(20, 0x00);
        frame[0]  = 0xAA;                                  // start byte 1
        frame[1]  = 0x55;                                  // start byte 2
        frame[2]  = 0x12;                                  // init message ID
        frame[3]  = bitrateVal;                            // CAN baud rate
        frame[4]  = 0x01;                                  // STD frame type
        // bytes 5-8:  filter ID = 0x00000000 (accept all)
        // bytes 9-12: mask ID   = 0x00000000 (accept all)
        frame[13] = this.#silent ? MODE_SILENT : MODE_NORMAL;
        frame[14] = 0x01;                                  // always 0x01 per spec
        // bytes 15-18: 0x00
        // checksum: sum of bytes 2..18
        let chk = 0;
        for (let i = 2; i <= 18; i++) chk += frame[i];
        frame[19] = chk & 0xFF;

        this.#port.write(frame, (err) => {
            if (err) this.emit('error', new Error(`Init write failed: ${err.message}`));
        });
    }

    // ---------------------------------------------------------------------------
    // Serial data handler — accumulates bytes and extracts frames
    // ---------------------------------------------------------------------------

    #onData(chunk) {
        this.#buffer = Buffer.concat([this.#buffer, chunk]);

        while (this.#buffer.length >= 6) {
            const startIdx = this.#buffer.indexOf(FRAME_START);

            if (startIdx === -1) {
                this.#buffer = Buffer.alloc(0);
                return;
            }

            if (startIdx > 0) {
                this.#buffer = this.#buffer.slice(startIdx);
            }

            if (this.#buffer.length < 2) return;

            const infoByte = this.#buffer[1];

            // Control frames start with 0xAA 0x55 — skip 20 bytes
            if (infoByte === 0x55) {
                if (this.#buffer.length < 20) return;
                this.#buffer = this.#buffer.slice(20);
                continue;
            }

            // Validate info byte: bits 7 and 6 must both be 1
            if ((infoByte & 0xC0) !== 0xC0) {
                this.#buffer = this.#buffer.slice(1);
                continue;
            }

            const ext = !!(infoByte & 0x20);  // bit 5: 0=STD 11-bit, 1=EXT 29-bit
            const rtr = !!(infoByte & 0x10);  // bit 4: 0=data, 1=remote
            const dlc =   infoByte & 0x0F;    // bits 3-0: data length

            if (dlc > 8) {
                this.#buffer = this.#buffer.slice(1);
                continue;
            }

            const idBytes  = ext ? 4 : 2;
            const frameLen = 1 + 1 + idBytes + dlc + 1;  // start + info + id + data + end

            if (this.#buffer.length < frameLen) return;

            if (this.#buffer[frameLen - 1] !== FRAME_END) {
                this.#buffer = this.#buffer.slice(1);
                continue;
            }

            // Parse message ID (little-endian)
            let id = 0;
            const idOffset = 2;
            for (let i = 0; i < idBytes; i++) {
                id |= (this.#buffer[idOffset + i] << (8 * i));
            }
            id = id >>> 0;

            const dataOffset = idOffset + idBytes;
            const data = Buffer.from(this.#buffer.slice(dataOffset, dataOffset + dlc));

            this.emit('frame', { id, ext, rtr, dlc, data });

            this.#buffer = this.#buffer.slice(frameLen);
        }
    }
}

module.exports = CanBus;

// ---------------------------------------------------------------------------
// Quick test — runs if executed directly:  node index.js
// ---------------------------------------------------------------------------
if (require.main === module) {
    const bus = new CanBus('/dev/ttyUSB0', { bitrate: 500, silent: true });

    bus.on('open',  ()    => console.log('[can-bus] Port open, listening...'));
    bus.on('close', ()    => console.log('[can-bus] Port closed'));
    bus.on('error', (err) => console.error('[can-bus] Error:', err.message));

    bus.on('frame', (f) => {
        const hex = f.data.toString('hex').match(/.{1,2}/g)?.join(' ') ?? '';
        console.log(
            `[${f.ext ? 'EXT' : 'STD'}${f.rtr ? '/RTR' : ''}]`,
            `ID: 0x${f.id.toString(16).toUpperCase().padStart(f.ext ? 8 : 3, '0')}`,
            `DLC: ${f.dlc}`,
            `Data: ${hex || '(none)'}`
        );
    });

    bus.open();

    process.on('SIGINT', () => {
        console.log('\nClosing...');
        bus.close();
        process.exit(0);
    });
}
