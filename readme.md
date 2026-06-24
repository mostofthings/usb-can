# usb-can

An EventEmitter-based Node.js driver for USB-CAN adapters using the CH340/CH341 chip and Seeed binary frame protocol. Compatible with the Seeed Studio USB-CAN Analyzer and similar generic adapters commonly available under various brand names.

> **Not compatible** with SLCAN text-protocol adapters (e.g. CANable) or SocketCAN-based devices.

## Installation

```bash
npm install usb-can
```

## Usage

```javascript
const CanBus = require('usb-can');

const bus = new CanBus('/dev/ttyUSB0', { bitrate: 500 });

bus.on('open',  ()    => console.log('Listening...'));
bus.on('error', (err) => console.error('Error:', err.message));

bus.on('frame', (frame) => {
  console.log(`ID: 0x${frame.id.toString(16).toUpperCase()} DLC: ${frame.dlc} Data: ${frame.data.toString('hex')}`);
});

bus.open();

process.on('SIGINT', () => bus.close());
```

## API

### `new CanBus(port, options?)`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `port` | `string` | — | Serial port path, e.g. `/dev/ttyUSB0` or `COM3` |
| `options.bitrate` | `number` | `500` | CAN bus bitrate in kbps |
| `options.silent` | `boolean` | `true` | Listen-only mode — recommended for monitoring |
| `options.reconnect` | `boolean` | `true` | Auto-reconnect on disconnect |
| `options.retryDelay` | `number` | `1000` | Initial reconnect delay in ms |
| `options.retryMax` | `number` | `10000` | Maximum reconnect delay after backoff in ms |
| `options.maxRetries` | `number` | `0` | Max reconnect attempts before giving up (0 = forever) |

### `bus.open()`

Opens the serial port and sends the initialization frame to the adapter.

### `bus.close()`

Closes the serial port. Suppresses automatic reconnect.

## Events

### `open`

Emitted when the port is successfully opened.

### `close`

Emitted when the port is closed intentionally via `bus.close()`.

### `disconnect`

Emitted when the port closes unexpectedly. Reconnect will be attempted automatically if `reconnect` is `true`.

### `reconnecting`

Emitted before each reconnect attempt.

```javascript
bus.on('reconnecting', ({ attempt, delay, max }) => {
  console.log(`Attempt ${attempt} in ${delay}ms`);
});
```

### `reconnected`

Emitted when the port is successfully reopened after a disconnect.

### `error`

Emitted on serial port errors or initialization failures.

### `frame`

Emitted for each decoded CAN frame.

```javascript
bus.on('frame', (frame) => {
  // frame.id    — number  — CAN message ID
  // frame.ext   — boolean — true = 29-bit extended, false = 11-bit standard
  // frame.rtr   — boolean — true = remote frame
  // frame.dlc   — number  — data length (0–8)
  // frame.data  — Buffer  — payload bytes
});
```

## Supported Bitrates

500, 250, 125, 100, 50, 20, 10, 5 kbps and 1000, 800, 400, 200 kbps.

## Requirements

- Node.js 14+
- [`serialport`](https://www.npmjs.com/package/serialport) (peer dependency)

## License

MIT
