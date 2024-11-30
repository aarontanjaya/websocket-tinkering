const net = require("net");
const http = require("http");
const crypto = require("crypto");

/** Function to generate the WebSocket accept key from the client's key
 * The Sec-WebSocket-Accept header is important in that the server must derive it from the Sec-WebSocket-Key that the client sent to it.
 * To get it, concatenate the client's Sec-WebSocket-Key and the string "258EAFA5-E914-47DA-95CA-C5AB0DC85B11" together (it's a "magic string"),
 * take the SHA-1 hash of the result, and return the base64 encoding of that hash.
 * This seemingly overcomplicated process exists so that it's obvious to the client whether the server supports WebSockets.
 * https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers
 */
function generateAcceptKey(secWebSocketKey) {
  const sha1 = crypto.createHash("sha1");

  sha1.update(secWebSocketKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
  return sha1.digest("base64");
}

const server = http.createServer((req, res) => {
  res.writeHead(404);
  res.end();
});

server.listen(8080, () => {
  console.log(
    "Server listening on http://localhost:8080 and ws://localhost:8080/ws"
  );
});

server.on("upgrade", (req, socket) => {
  if (req.url !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  const secWebSocketKey = req.headers["sec-websocket-key"];
  const secWebSocketAccept = generateAcceptKey(secWebSocketKey);

  const responseHeaders = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${secWebSocketAccept}`,
    "",
    "",
  ];
  socket.write(responseHeaders.join("\r\n"));

  socket.on("data", (data) => {
    const message = parseFrame(data);
    console.log("messagenya", message);
    sendMessage(socket, "test");
  });

  socket.on("end", () => {
    console.log("Connection ended");
  });

  socket.on("error", (err) => {
    console.error("Socket error:", err);
  });

  // Send a message every 5 seconds
  setInterval(() => {
    sendMessage(socket, "repeat after me");
  }, 5000);
});

function parseFrame(buffer) {
  /**
   * Frame format:

      0                   1                   2                   3
      0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
     +-+-+-+-+-------+-+-------------+-------------------------------+
     |F|R|R|R| opcode|M| Payload len |    Extended payload length    |
     |I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
     |N|V|V|V|       |S|             |   (if payload len==126/127)   |
     | |1|2|3|       |K|             |                               |
     +-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
     |     Extended payload length continued, if payload len == 127  |
     + - - - - - - - - - - - - - - - +-------------------------------+
     |                               |Masking-key, if MASK set to 1  |
     +-------------------------------+-------------------------------+
     | Masking-key (continued)       |          Payload Data         |
     +-------------------------------- - - - - - - - - - - - - - - - +
     :                     Payload Data continued ...                :
     + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
     |                     Payload Data continued ...                |
     +---------------------------------------------------------------+

   */
  const secondByte = buffer[1];
  // https://stackoverflow.com/questions/14174184/what-is-the-mask-in-a-websocket-frame
  const isMasked = (secondByte & 128) === 128;
  const payloadLength = secondByte & 127; // 0b01111111

  let dataStart = 2; // if not masked and payload length is lowerthan 125, data starts at 3rd byte
  if (payloadLength === 126) {
    dataStart += 2; // Extended payload length (16-bit)
  } else if (payloadLength === 127) {
    dataStart += 8; // Extended payload length (64-bit)
  }

  // if masked need to accommodate for 32bit masking key
  const maskingKey = isMasked ? buffer.slice(dataStart, dataStart + 4) : null;
  const payloadData = buffer.slice(dataStart + (isMasked ? 4 : 0));

  if (isMasked) {
    for (let i = 0; i < payloadData.length; i++) {
      /**
       * Each byte of the payload is XORed with the corresponding byte of the masking key.
       * If the payload is longer than 4 bytes, the masking key is repeated cyclically.
       */
      payloadData[i] ^= maskingKey[i % 4];
    }
  }

  return payloadData.toString();
}

function sendMessage(socket, message) {
  /**
   *  for client side we'll need masking, set first bit of second byte in the frame to 1 0x80 -> 10000000.
   *  It's not really needed for messages from server side tho, so we'll set it as 0.
   *  Masking key length will be 4 bytes, hence the length will be 4 if we send it client-side
   */
  const isClient = false; //

  const maskingLength = isClient ? 4 : 0;
  const maskingFlag = isClient ? 0x80 : 0;
  const payload = Buffer.from(message, "utf8");
  const payloadLength = payload.length;

  let frame;
  if (payloadLength < 126) {
    frame = Buffer.alloc(2 + maskingLength + payloadLength);
    frame[1] = maskingFlag | payloadLength; // Payload length
  } else if (payloadLength < 65536) {
    frame = Buffer.alloc(4 + maskingLength + payloadLength);
    frame[1] = maskingFlag | 126; // Extended payload length indicator
    frame.writeUInt16BE(payloadLength, 2); // Write length in 2 bytes
  } else {
    frame = Buffer.alloc(10 + maskingLength + payloadLength);
    frame[1] = maskingFlag | 127; // Extended payload length indicator
    frame.writeBigUInt64BE(BigInt(payloadLength), 2); // Write length in 8 bytes
  }

  // WebSocket frame header (FIN + Text frame)
  frame[0] = 0x81;

  if (isClient) {
    // Generate a random mask and apply it to the payload
    const maskKey = Buffer.alloc(4);
    for (let i = 0; i < 4; i++) {
      maskKey[i] = Math.floor(Math.random() * 256); // Random mask key
    }

    // Add the mask key to the frame
    maskKey.copy(frame, frame.length - payloadLength - maskingLength);

    // Apply the mask to the payload
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i % 4];
    }
  }

  // Copy the (masked) payload into the frame
  payload.copy(frame, frame.length - payloadLength);

  // Send the frame to the client
  try {
    console.log("frame", frame, message, frame.length, payloadLength);
    socket.write(frame);
  } catch (err) {
    console.log("errornya", err);
  }
}
