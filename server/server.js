#!/usr/bin/env node

var WebSocketServer = require('websocket').server,
    http = require('http'),
    url = require('url'),
    fs = require('fs'),
    express = require('express');

var Chatroom = require('./chatroom.js'),
    Client = require('./client.js'),
    Constants = require('./constants.js'),
    Config = require('./config.json');

var server = http.createServer(function(request, response) {
    var headers, parts, chatroom, id, data = '';
    console.log((new Date()) + ' Received request for ' + request.url);

    // CORS (allows access to API from other domains)
    // (needed because API server does not host static HTML/JS which uses it)
    headers = {
        'Access-Control-Allow-Origin': (Constants.DEBUG_MODE ? '*' : Config.origin),
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json; charset=utf-8'
    };

    // parse path
    parts = url.parse(request.url, true);

    if (parts.pathname === '/new' && request.method === 'POST') {
        request.on('data', function (chunk) {
            data += chunk
        });
        request.on('end', function () {
            try {
                data = JSON.parse(data);
            } catch (e) {
                response.writeHead(400, headers);
                response.end(JSON.stringify({
                    error: '400 Bad Request'
                }));
                return;
            }
            chatroom = new Chatroom(data.title);
            response.writeHead(200, headers);
            response.end(JSON.stringify({
                chatroom: chatroom
            }));
        });
    } else if (parts.pathname === '/new' && request.method === 'OPTIONS') {
        response.writeHead(200, headers);
        response.end();
    } else {
        response.writeHead(404, headers);
        response.end(JSON.stringify({
            error: '404 Page Not Found'
        }));
    }
});
server.listen(9004, function() {
    console.log((new Date()) + ' Server is listening on port 9004');
});

wsServer = new WebSocketServer({
    httpServer: server,
    autoAcceptConnections: false
});

wsServer.on('request', function(request) {
    var client = null, chatroom = null, connection;

    if (!Constants.DEBUG_MODE && request.origin !== Config.origin) {
        request.reject();
        console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
        return;
    }

    try {
        connection = request.accept('lounge', request.origin);
    } catch (e) {
        console.log('Caught error: ' + e);
        request.reject();
        return;
    }
    console.log((new Date()) + ' Connection accepted from IP ' + connection.remoteAddress);

    connection.once('message', function (message) {
        var msg, i, users, nonEmptyChatrooms, args, results, name, cmd;

        // handle unexpected packet types
        // we don't use binary frames
        if (message.type !== 'utf8') {
            connection.sendUTF(JSON.stringify({
                type: 'kick',
                reason: 'protocol_error'
            }));
            connection.close();
            return;
        }

        // every frame is a JSON-encoded packet
        try {
            msg = JSON.parse(message.utf8Data);
        } catch (e) {
            connection.sendUTF(JSON.stringify({
                type: 'kick',
                reason: 'protocol_error'
            }));
            connection.close();
            return;
        }

        // first packet MUST be set_chatroom
        if (msg.type !== 'set_chatroom') {
            connection.close();
            return;
        }

        // check for id
        if (!Chatroom.haveChatroom(msg.id)) {
            connection.sendUTF(JSON.stringify({
                type: 'error',
                error: 'not_found'
            }));
            connection.close();
            return;
        }


        // hand over to Client
        client = new Client(connection, Chatroom.get(msg.id), msg.control);
    });
});

if (Config.useInternalServer) {
    var app = express();
    app.use("/lounge.js", function(req,res) {
        var lounge_js = fs.readFileSync("../htdocs/lounge.js", {encoding: 'utf8'})
        .replace("http://lounge.ajf.me", (Constants.DEBUG_MODE ? Config.debugOrigin : Config.origin));
        res.send(lounge_js);
    });
    app.use("/", express.static("../htdocs"));
    app.use("/", function(req,res) {
        var index_html = fs.readFileSync("../htdocs/index.html", {encoding: 'utf8'});
        // Static lookup failed
        res.send(index_html);
    });
    if (Constants.DEBUG_MODE) {
        var port = Number(Config.debugOrigin.match(/[0-9]+$/)) || 8000;
        app.listen(port);
        console.log("[InternalServer] Listening on port " + port);
    } else {
        app.listen(80);
        console.log("[InternalServer] Listening on port 80");
    }
}

var keypress = require('keypress');

keypress(process.stdin);

process.stdin.on('keypress', function (chunk, key) {
    if (key && key.name === 'u') {
        // kick for update
        Client.update();
        wsServer.shutDown();
        console.log('Gracefully shut down server with 5s update-refresh message sent. Exiting.');
        process.exit();
    } else if (key && key.ctrl && key.name === 'c') {
        process.exit();
    }
});

process.stdin.setRawMode(true);
process.stdin.resume();
