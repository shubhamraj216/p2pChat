'use strict';

var os = require('os');
var nodeStatic = require('node-static');
var http = require('http');
var socketIO = require('socket.io');
var rooms = [];

var fileServer = new(nodeStatic.Server)();
var app = http.createServer(function(req, res) {
  fileServer.serve(req, res);
}).listen(3077);

var io = socketIO.listen(app);

io.sockets.on('connection', function(socket) {

  // convenience function to log server messages on the client
  function log() {
    var array = ['Message from server:'];
    array.push.apply(array, arguments);
    socket.emit('log', array);
  }

  socket.on('message', function(message) {
    log('Client said this: ', message);
    log('Room: ', socket.room);
    socket.broadcast.to(socket.room).emit('message', message);
  });

  socket.on('create or join', function(message) {
    var room = message.room;
    socket.room = room;
    var clientID = message.id;

    log('Received request to create or join room ' + room);

    var clientsInRoom = io.sockets.adapter.rooms[room];
    var numClients = clientsInRoom ? Object.keys(clientsInRoom.sockets).length : 0;
    log('Room ' + room + ' now has ' + numClients + ' client(s)');
    log(rooms);
    
    if (numClients === 0) {
      rooms.push(room);
      socket.join(room);
      log('Client ID ' + clientID + ' created room ' + room);
      socket.emit('created', room);
    } else {
      log('Client ID ' + clientID + ' joined room ' + room);
      socket.join(room);
      socket.emit('joined', room);
    } 
    io.sockets.in(room).emit('ready', clientID);
  });

  socket.on('ipaddr', function() {
    log("IPADDR:");
    var ifaces = os.networkInterfaces();
    for (var dev in ifaces) {
      ifaces[dev].forEach(function(details) {
        if (details.family === 'IPv4' && details.address !== '127.0.0.1') {
          socket.emit('ipaddr', details.address);
        }
      });
    }
  });
});
