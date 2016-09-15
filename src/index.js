/* This module does a lot of monkeypatching, but unfortunately that appears to be the only way to
 * accomplish this kind of stuff in Express.
 *
 * Here be dragons. */

import http from 'http';
import express from 'express';
import ws from 'ws';
import socketIO from 'socket.io';
import EventEmitter from 'eventemitter2'

import websocketUrl from './websocket-url';
import addWsMethod from './add-ws-method';

export function expressWs(app, httpServer, options = {}) {
  let server = httpServer;

  if (server === null || server === undefined) {
    /* No HTTP server was explicitly provided, create one for our Express application. */
    server = http.createServer(app);

    app.listen = function serverListen() {
      server.listen.apply(server, arguments);
    };
  }

  /* Make our custom `.ws` method available directly on the Express application. You should
   * really be using Routers, though. */
  addWsMethod(app);

  /* Monkeypatch our custom `.ws` method into Express' Router prototype. This makes it possible,
   * when using the standard Express Router, to use the `.ws` method without any further calls
   * to `makeRouter`. When using a custom router, the use of `makeRouter` may still be necessary.
   *
   * This approach works, because Express does a strange mixin hack - the Router factory
   * function is simultaneously the prototype that gets assigned to the resulting Router
   * object. */
  if (!options.leaveRouterUntouched) {
    addWsMethod(express.Router);
  }

  let socketServer = null
  if(options.isSocketIO){
    socketServer = socketIO.listen(server)
    socketServer.use(require('socketio-wildcard')());
    socketServer.on('connection', (socket) => {
      socket.on('*', function(pack){
        if(pack.data[0][0] == '/'){
          const request = socket.request;

          request._ws = socket;
          request.ws = new EventEmitter({wildcard: true});
          request.ws.on('*', function(...args) {
            args.unshift( pack.data[0], this.event)
            request._ws.emit(...args)
          })
          request.ws.data = pack.data
          request.ws.event = pack.data[1]
          request.ws.body = pack.data[2]
          request.url = websocketUrl(pack.data[0])

          request.wsHandled = false;

          request.wsData = pack.data
          request.event = pack.data[1]
          request.body = pack.data[2]
          const dummyResponse = new http.ServerResponse(request);

          dummyResponse.writeHead = function writeHead(statusCode) {
            // if (statusCode > 200) {
            //   /* Something in the middleware chain signalled an error. */
            //   socket.close();
            // }
          };

          app.handle(request, dummyResponse, () => {
            // if (!request.wsHandled) {
            //   /* There was no matching WebSocket-specific route for this request. We'll close
            //    * the connection, as no endpoint was able to handle the request anyway... */
            //   socket.close();
            // }
          });

        }
      })
      //   require('fs').writeFileSync(__dirname + '/1.json', JSON.stringify(client))
      //   //, client.socket
      // // client.on('hi', this.log.error)
      // client.on('join', function(data) {
      //     console.log(data);
      //     client.emit('messages', 'Hello from server');
      //     client.emit('news', 'Hello from server');
      // });
    })
  } else {
    const wsServer = new ws.Server({ server });
    wsServer.on('connection', (socket) => {
      const request = socket.upgradeReq;

      request.ws = socket;
      request.wsHandled = false;

      /* By setting this fake `.url` on the request, we ensure that it will end up in the fake
       * `.get` handler that we defined above - where the wrapper will then unpack the `.ws`
       * property, indicate that the WebSocket has been handled, and call the actual handler. */
      request.url = websocketUrl(request.url);

      const dummyResponse = new http.ServerResponse(request);

      dummyResponse.writeHead = function writeHead(statusCode) {
        if (statusCode > 200) {
          /* Something in the middleware chain signalled an error. */
          socket.close();
        }
      };

      app.handle(request, dummyResponse, () => {
        if (!request.wsHandled) {
          /* There was no matching WebSocket-specific route for this request. We'll close
           * the connection, as no endpoint was able to handle the request anyway... */
          socket.close();
        }
      });
    });

  }

  return {
    app,
    socketIO: socketServer,
    getWss: function getWss() {
      return wsServer;
    },
    applyTo: function applyTo(router) {
      addWsMethod(router);
    }
  };
}
