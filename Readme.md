### Websocket Tinkering

A simple basic websocket client and server, implemented using nodejs and plain html and js. This project only uses the `http` and `crypto` package without `ws` to explore the basics of websockets.

To start the server run this in the server folder:

`node index.js`

Simply open the index.html in a browser to run the client-side.

This project is made for learning purposes only so it's very limited in its capability. The code will initiate a websocket upgrade/handshake upon button click, and receive + display a repeated message streamed from the server every 5 seconds.
