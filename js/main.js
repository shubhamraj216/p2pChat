'use strict';
// var _pcConfig = {
//   'iceServers': [
//     {
//       'url': 'stun:stun.l.google.com:19302'
//     },
//     {
//       "urls": "turn:your-aws-instance:3478?transport=tcp",
//       "username": "username",
//       "credential": "password"
//     },
//     {
//       "urls": "stun:your-aws-instance:3478?transport=tcp"
//     }
//   ]
// };

// Intial WEBRTC setup
var config = null;
var socket = io.connect(); // Connect to the signaling server
var myID;
var myRoom;
var dataChannel;
var opc = {}; // offer PC
var apc = {}; // answer PC
var offerChannel = {}; // currently having same communication channel
var sendChannel = {};
var defaultChannel = socket;  // currently same communication channel
var privateChannel = socket;  // currently same communication channel

// Require from html
var globalChat = document.getElementById('globalChat');
var privateChat = document.getElementById('privateChat');
var globalText = document.getElementById('globalText');
var globalBtn = document.getElementById('globalBtn');
var receiver = document.getElementById('receiver');
var privateText = document.getElementById('privateText');
var privateBtn = document.getElementById('privateBtn');

// Attach event handlers
globalBtn.addEventListener('click', globalSend, false);
privateBtn.addEventListener('click', privateSend, false);

// Disable send buttons by default.
globalBtn.disabled = true;
privateBtn.disabled = true;

// Create a random room if not already present in the URL.
var isInitiator;
var room = window.location.hash.substring(1);
if (!room) {
  // room = window.location.hash = randomToken();
  
  let temp = ""; // testing purpose
  while(temp.length == 0) { // testing purpose
    temp = prompt('Enter Room Name'); // testing purpose
  } // testing purpose
  room = window.location.hash = temp; // testing purpose
}
if (location.hostname.match(/localhost|127\.0\.0/)) {
  socket.emit('ipaddr');
}

// Main Setup
function joinRoom(roomName) {
  myRoom = roomName;
  // myID = generateID();

  let name = ""; // testing purpose
  while(name.length == 0) { // testing purpose
    name = prompt('Enter Your Name'); // testing purpose
  } // testing purpose
  myID = name; // testing purpose

  console.log('My Id: ' + myID);

  setDefaultChannel();

  if(room != '') {
    socket.emit('create or join', {room: myRoom, id: myID});
  }

  setPrivateChannel();

  window.onbeforeunload = function (e) {
    defaultChannel.emit('message', { type: 'bye', from: myID });
  }
}

joinRoom(room);

function setDefaultChannel() {
  defaultChannel.on('ipaddr', function(ipaddr) {
    console.log('Server IP address is: ' + ipaddr);
  });

  defaultChannel.on('created', function(room) {
    console.log('Created room', room, '- my client ID is', myID);
    isInitiator = true;
    setUpDone();
  });

  defaultChannel.on('joined', function(room) {
    console.log('This peer has joined room', room, 'with client ID', myID);
    isInitiator = false;
    setUpDone();
  });

  defaultChannel.on('full', function(room) {
    alert('Room ' + room + ' is full. We will create a new room for you.');
    window.location.hash = '';
    window.location.reload();
  });

  defaultChannel.on('log', function(array) {
    console.log.apply(console, array);
  });

  defaultChannel.on('ready', function(newParticipantID) {
    console.log('Socket is ready');
    appender(newParticipantID, 'joined the room.', globalChat);
  });

  // For creating offers and receiving answers(of offers sent).
  defaultChannel.on('message', function(message) {
    if(message.type === 'newparticipant') {
      console.log('Client received message for New Participation:', message);
      var partID = message.from;

      offerChannel[partID] = socket; // for opening new communication channel to new participant

      offerChannel[partID].on('message', function(msg) {
        if(msg.dest === myID) {
          if(msg.type  === 'answer') {
            console.log('Got Answer.')
            opc[msg.from].setRemoteDescription(new RTCSessionDescription(msg.snDescription), function() {}, logError);
          } else if(msg.type === 'candidate') {
            console.log('Got ICE Candidate from ' + msg.from);
            opc[msg.from].addIceCandidate(new RTCIceCandidate({ 
              candidate: msg.candidate, 
              sdpMid: msg.id, 
              sdpMLineIndex: msg.label, 
            }));
          }
        }
      });
      createOffer(partID);
    } else if(message.type === 'bye') {
      ParticipationClose(message.from);
    }
  });
}

function setPrivateChannel() {
  // For receiving offers or ice candidates
  privateChannel.on('message', function(message) {
    if(message.dest === myID) {
      console.log('Client received message(Offer or ICE candidate):', message);
      if(message.type === 'offer') {
        createAnswer(message, privateChannel, message.from);
      } else if(message.type === 'candidate') {
        apc[message.from].addIceCandidate(new RTCIceCandidate({ 
          candidate: message.candidate, 
          sdpMid: message.id, 
          sdpMLineIndex: message.label, 
        }));
      }
    }
  })
}

// when someone in room says Bye
function ParticipationClose(from) {
  console.log('Bye Received from client: ' + from);

  if(opc.hasOwnProperty(from)) {
    opc[from].close();
    opc[from] = null;
  }

  if(apc.hasOwnProperty(from)) {
    apc[from].close();
    apc[from] = null;
  }

  if(sendChannel.hasOwnProperty(from)) {
    delete sendChannel[from];
  }

  appender(from, 'left the room', globalChat);
}

// Create Offer
function createOffer(partID) {
  console.log('Creating an offer for: ' + partID);
  opc[partID] = new RTCPeerConnection(config);
  opc[partID].onicecandidate = function(event) {
    console.log('IceCandidate event:', event);
    if (event.candidate) {
      offerChannel[partID].emit('message', {
        type: 'candidate',
        label: event.candidate.sdpMLineIndex,
        id: event.candidate.sdpMid,
        candidate: event.candidate.candidate,
        from: myID,
        dest: partID
      });
    } else {
      console.log('End of candidates.');
    }
  };

  try {
    console.log('Creating Send Data Channel');
    sendChannel[partID] = opc[partID].createDataChannel('exchange', {reliable: false});
    onDataChannelCreated(sendChannel[partID], 'send');
  
    var LocalSession = function (partID) {
      return function (sessionDescription) {
        var channel = offerChannel[partID];
  
        console.log('Local Session Created: ', sessionDescription);
        opc[partID].setLocalDescription(sessionDescription, function() {}, logError);
        
        console.log('Sending Local Description: ', opc[partID].localDescription);
        channel.emit('message', {snDescription: sessionDescription, from: myID, dest: partID, type: 'offer'});
      }
    }
    opc[partID].createOffer(LocalSession(partID), logError);
  } catch(e) {
    console.log('createDataChannel failed with exception: ' + e);
  }
}


// Create Answer
function createAnswer(msg, channel, to) {
  console.log('Got offer. Sending answer to peer.');
  apc[to] = new RTCPeerConnection(config);
  apc[to].setRemoteDescription(new RTCSessionDescription(msg.snDescription), function() {}, logError);
  
  apc[to].ondatachannel = function(event) {
    console.log('onReceivedatachannel:', event.channel);
    sendChannel[to] = event.channel;
    onDataChannelCreated(sendChannel[to], 'receive');
  };

  var LocalSession = function (channel) {
    return function (sessionDescription) {
      console.log('Local Session Created: ', sessionDescription);
      apc[to].setLocalDescription(sessionDescription, function() {}, logError);
      console.log('Sending answer to ID: ', to);
      channel.emit('message', {snDescription: sessionDescription, from: myID, dest: to, type: 'answer'});
    }
  }
  apc[to].createAnswer(LocalSession(channel), logError);

  appender(to, ' is in the room', privateChat);
}

// Data Channel Setup
function onDataChannelCreated(channel, type) {
  console.log('onDataChannelCreated:' + channel + ' with ' + type + ' state');

  channel.onopen = ChannelStateChangeOpen(channel);
  channel.onclose = ChannelStateChangeClose(channel);

  channel.onmessage = receiveMessage();
}

function ChannelStateChangeClose(channel) {
  return function() {
    console.log('Channel closed: ' + channel);
  }
}

function ChannelStateChangeOpen(channel) {
  return function() {
    console.log('Channel state: ' + channel.readyState);

    var open = checkOpen();
    enableDisable(open);
  }
}

// Check data channel open
function checkOpen() {
  var open = false;
  for(let channel in sendChannel) {
    if(sendChannel.hasOwnProperty(channel)) {
      open = (sendChannel[channel].readyState == 'open');
      if(open == true) {
        break;
      }
    }
  }
  return open;
}

// Enable/ Disable Buttons
function enableDisable(open) {
  if(open) {
    console.log('CHANNEL opened!!!');
    globalBtn.disabled = false;
    privateBtn.disabled = false;
    isInitiator = true;
  } else {
    console.log('CHANNEL closed!!!');
    globalBtn.disabled = true;
    privateBtn.disabled = true;
  }
}

// Upon Initial setup send a message to other peers for connection
function setUpDone() {
  console.log('Initial Setup Done ...');
  socket.emit('message', { type: 'newparticipant', from: myID }, myRoom);
}



function receiveMessage() {
  var count, currCount, str;
  return function onmessage(event) {
    // console.log(event.data);
    // renderMessage(event.data);
    if(isNaN(event.data) == false) {
      count = parseInt(event.data);
      currCount = 0;
      str = "";
      console.log(`Expecting a total of ${count} characters.`);
      return;
    }

    var data = event.data;
    str += data;
    currCount += str.length;
    console.log(`Received ${currCount} characters of data.`);

    if(currCount == count) {
      console.log(`Rendering Data`);
      renderMessage(str);
    }
  };
}



function globalSend() {
  // Split data channel message in chunks of this byte length.
  var CHUNK_LEN = 4000; // 64000

  var resObj = {};
  resObj['sender'] = myID;
  resObj['type'] = 'global';
  resObj['response'] = globalText.value;

  var data = JSON.stringify(resObj);

  var len = data.length;
  var n = len / CHUNK_LEN | 0;

  if (!sendChannel) {
    alert('Connection has not been initiated. Get two peers in the same room first');
    logError('Connection has not been initiated. ' + 'Get two peers in the same room first');
    return;
  } 

  // send the length of data
  for(let key in sendChannel) {
    if(sendChannel.hasOwnProperty(key) && sendChannel[key].readyState === 'open') {
      console.log("Global: Sending a data of length: " + len);
      sendChannel[key].send(len);
    }
  }

  // split the text and send in chunks of about 64KB
  for(let key in sendChannel) {
    if(sendChannel.hasOwnProperty(key) && sendChannel[key].readyState === 'open') {
      for (var i = 0; i < n; i++) {
        var start = i * CHUNK_LEN,
        end = (i + 1) * CHUNK_LEN;
        console.log(start + ' - ' + (end - 1));
        sendChannel[key].send(data.substr(start, end));
      }
    }
  }

  // send the reminder, if any
  for(let key in sendChannel) {
    if(sendChannel.hasOwnProperty(key) && sendChannel[key].readyState === 'open') {
    if (len % CHUNK_LEN) {
      console.log(n * CHUNK_LEN + ' - ' + len);
      sendChannel[key].send(data.substr(n * CHUNK_LEN));
    }}
  }

  console.log('Sent all Data!');
  globalText.value = "";
  renderMessage(data);
}

function privateSend() {
  // Split data channel message in chunks of this byte length.
  var CHUNK_LEN = 4000; // 64000

  var resObj = {};
  resObj['sender'] = myID;
  resObj['type'] = 'private';
  resObj['response'] = privateText.value;

  var data = JSON.stringify(resObj);

  var len = data.length;
  var n = len / CHUNK_LEN | 0;

  var target = receiver.value;

  if (!sendChannel[target]) {
    alert('Connection has not been initiated, or target is not in room.');
    logError('Connection has not been initiated, ' + 'or target is not in room.');
    return;
  } 

  // send the length of data
  if(sendChannel[target].readyState === 'open') {
    console.log("Private: Sending a data of length: " + len);
    sendChannel[target].send(len);
  }

  // split the text and send in chunks of about 64KB
  if(sendChannel[target].readyState === 'open') {
    for (var i = 0; i < n; i++) {
      var start = i * CHUNK_LEN,
      end = (i + 1) * CHUNK_LEN;
      console.log(start + ' - ' + (end - 1));
      sendChannel[target].send(data.substr(start, end));
    }
  }

  // send the reminder, if any
  if(sendChannel[target].readyState === 'open') {
    if (len % CHUNK_LEN) {
      console.log(n * CHUNK_LEN + ' - ' + len);
      sendChannel[target].send(data.substr(n * CHUNK_LEN));
    }
  }

  console.log('Sent all Data!');
  privateText.value = "";
  receiver.value = "";
  renderMessage(data);
}

function renderMessage(data) {
  var obj = JSON.parse(data);
  var type = obj.type;
  var sender = obj.sender;
  var text = obj.response;
  
  if(type === 'global') {
    appender(sender, text, globalChat);
  } else {
    appender(sender, text, privateChat);
  }
}

function appender(id, msg, Chat) {
  let strong = document.createElement('strong');
  strong.appendChild(document.createTextNode(`${id}: `));

  let span = document.createElement('span');
  span.appendChild(document.createTextNode(msg));
  
  let li = document.createElement('li');
  li.appendChild(strong)
  li.appendChild(span);

  Chat.appendChild(li);
  Chat.scrollTop = Chat.scrollHeight;
}

// Generator for Room ID
function randomToken() {
  return Math.floor((1 + Math.random()) * 1e16).toString(16).substring(1);
}

// Generator for USER ID
function generateID() {
  var s4 = function () {
    return Math.floor(Math.random() * 0x10000).toString(16);
  };
  // return s4() + s4() + "-" + s4() + "-" + s4() + "-" + s4() + "-" + s4() + s4() + s4(); 
  return s4(); // testing purpose
}

function logError(err) {
  if (!err) return;
  if (typeof err === 'string') {
    console.warn(err);
  } else {
    console.warn(err.toString(), err);
  }
}
