require('dotenv').config();
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const expressSession = require('express-session');
const bodyparser = require('body-parser');
const { readUsers } = require('./utils/user');
const userRoutes = require('./routes/user');
const dashboardRoutes = require('./routes/dashboard');
const authMiddleware = require('./middleware/auth');
const accountRoutes = require('./routes/account');
const socketIO = require('socket.io');
const http = require('http');
const CryptoJS = require('crypto-js');
const fs = require('fs');

const server = http.createServer(app);

const io = socketIO(server);

const messages = [];
const messagesFilePath = 'messages.json';

const activeCalls = {};

function getDmRoomId(userId1, userId2) {
  return [userId1, userId2].sort().join('-');
}

fs.readFile(messagesFilePath, 'utf8', (err, data) => {
  if (!err) {
    try {
      const parsedMessages = JSON.parse(data);
      if (Array.isArray(parsedMessages)) {
        messages.push(...parsedMessages);
        console.log('Messages loaded from file.');
      } else {
        console.error('Error: Data read from messages file is not an array.');
      }
    } catch (parseError) {
      console.error('Error parsing messages file:', parseError);
    }
  } else {
    console.log('No messages file found, starting with an empty message array.');
  }
});

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use('/others', express.static('others'));
app.use(bodyparser.urlencoded({ extended: false }));
app.use(express.json());

app.use(expressSession({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true
}));

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('joinRoom', (userId) => {
    socket.join(userId);
    console.log(`User ${socket.id} joined room ${userId}`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const dmRoomId in activeCalls) {
      const call = activeCalls[dmRoomId];
      if (call.participants.includes(socket.id)) {
        call.participants = call.participants.filter(id => id !== socket.id);
        call.screensharers = call.screensharers.filter(id => id !== socket.id);
        socket.leave(dmRoomId);
        console.log(`User ${socket.id} disconnected and left call in room ${dmRoomId}`);

        if (call.participants.length === 0) {
          delete activeCalls[dmRoomId];
          io.to(dmRoomId).emit('call-state-update', { dmRoomId, call: null });
          console.log(`Call in room ${dmRoomId} ended due to disconnect.`);
        } else {
          io.to(dmRoomId).emit('call-state-update', { dmRoomId, call: call });
        }
      }
    }
  });

  socket.on('start-call', ({ callerId, targetUserId }) => {
    const dmRoomId = getDmRoomId(callerId, targetUserId);
    if (!activeCalls[dmRoomId]) {
      activeCalls[dmRoomId] = {
        callerId: callerId,
        participants: [],
        screensharers: []
      };
    }
    if (!activeCalls[dmRoomId].participants.includes(callerId)) {
      activeCalls[dmRoomId].participants.push(callerId);
    }
    socket.join(dmRoomId);
    console.log(`User ${callerId} started and joined call in room ${dmRoomId}`);
    io.to(dmRoomId).emit('call-state-update', { dmRoomId, call: activeCalls[dmRoomId] });
  });

  socket.on('join-call', ({ userId, targetUserId }) => {
    const dmRoomId = getDmRoomId(userId, targetUserId);
    if (activeCalls[dmRoomId]) {
      if (!activeCalls[dmRoomId].participants.includes(userId)) {
        activeCalls[dmRoomId].participants.push(userId);
      }
      socket.join(dmRoomId);
      console.log(`User ${userId} joined call in room ${dmRoomId}`);
      io.to(dmRoomId).emit('call-state-update', { dmRoomId, call: activeCalls[dmRoomId] });
    } else {
      console.log(`Attempted to join non-existent call in room ${dmRoomId}`);
    }
  });

  socket.on('leave-call', ({ userId, targetUserId }) => {
    const dmRoomId = getDmRoomId(userId, targetUserId);
    if (activeCalls[dmRoomId]) {
      activeCalls[dmRoomId].participants = activeCalls[dmRoomId].participants.filter(id => id !== userId);
      activeCalls[dmRoomId].screensharers = activeCalls[dmRoomId].screensharers.filter(id => id !== userId);
      socket.leave(dmRoomId);
      console.log(`User ${userId} left call in room ${dmRoomId}`);

      if (activeCalls[dmRoomId].participants.length === 0) {
        delete activeCalls[dmRoomId];
        io.to(dmRoomId).emit('call-state-update', { dmRoomId, call: null }); 
        console.log(`Call in room ${dmRoomId} ended.`);
      } else {
        io.to(dmRoomId).emit('call-state-update', { dmRoomId, call: activeCalls[dmRoomId] });
      }
    }
  });

  socket.on('chat message', (msg) => {
    const { senderId, receiverId, type, content } = msg;

    let encryptedContent = content;
    if (type === 'text') {
      const secretKey = process.env.CRYPTO_SECRET_KEY;
      encryptedContent = CryptoJS.AES.encrypt(content, secretKey).toString();
    }

    const newMessage = {
      senderId: senderId,
      receiverId: receiverId,
      type: type,
      content: encryptedContent,
      timestamp: new Date().toISOString()
    };

    messages.push(newMessage);

    fs.writeFile(messagesFilePath, JSON.stringify(messages), (err) => {
      if (err) {
        console.error('Error saving messages to file:', err);
      }
    });

    io.to([senderId, receiverId]).emit('chat message', newMessage);
  });

  socket.on('friendRequestAccepted', (data) => {
    console.log('friendRequestAccepted:', data);
    alert(`friendRequestAccepted from ${data.accepterUsername}!`);
    location.reload();
  });

  socket.on('unfriended', (data) => {
    console.log('You have been unfriended:', data.unfrienderUsername);
    alert(`You have been unfriended by ${data.unfrienderUsername}!`);
    location.reload();
  });

  socket.on('webrtc-signal', (data) => {
    const { dmRoomId, senderId, targetUserId, signal } = data;
    if (dmRoomId && activeCalls[dmRoomId]) {
      socket.to(dmRoomId).emit('webrtc-signal', { dmRoomId, senderId, signal });
    } else if (targetUserId) {
      io.to(targetUserId).emit('webrtc-signal', { dmRoomId, senderId, signal });
    } else {
      console.warn('webrtc-signal received without dmRoomId or targetUserId:', data);
    }
  });
});

app.get('/api/user/:id', authMiddleware, async (req, res) => {
  const users = await readUsers();
  const userId = req.params.id;
  const user = users.find(u => u.id === userId);
  if (user) {
    res.json({ id: user.id, username: user.username, profilepicture: user.profilepicture });
  } else {
    res.status(404).json({ message: 'User not found' });
  }
});

app.get('/dm/:id', authMiddleware, async (req, res) => {
  const users = await readUsers();
  const targetUserId = req.params.id;
  const targetUser = users.find(u => u.id === targetUserId);

  if (!targetUser) {
    return res.status(404).render('error', { message: 'User not found.' });
  }

  const currentUser = req.session.user;
  if (!currentUser.friends || !currentUser.friends.includes(targetUser.username)) {
    return res.redirect('/dashboard?message=' + encodeURIComponent('You can only DM friends.'));
  }

  const conversationMessages = messages
    .filter(msg =>
      (msg.senderId === currentUser.id && msg.receiverId === targetUserId) ||
      (msg.senderId === targetUserId && msg.receiverId === currentUser.id)
    )
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  res.render('dm', {
    user: currentUser,
    targetUser: targetUser,
    users: users,
    messages: conversationMessages
  });
});

app.post('/dm/:id/send', authMiddleware, (req, res) => {
  const targetUserId = req.params.id;
  const currentUser = req.session.user;
  const messageContent = req.body.message;

  if (messageContent && messageContent.trim()) {
    const newMessage = {
      senderId: currentUser.id,
      receiverId: targetUserId,
      type: 'text',
      content: messageContent.trim(),
      timestamp: new Date().toISOString()
    };

    messages.push(newMessage);

    fs.writeFile(messagesFilePath, JSON.stringify(messages), (err) => {
      if (err) {
        console.error('Error saving messages to file:', err);
      }
    });

    io.to([currentUser.id, targetUserId]).emit('chat message', newMessage);
  }
  res.redirect(`/dm/${targetUserId}`);
});

app.use('/', userRoutes);
app.use('/dashboard', authMiddleware, dashboardRoutes);
app.use('/', authMiddleware, accountRoutes);
app.use('/vc', authMiddleware, require('./routes/voice'));

app.set('io', io);

app.get('/', (req, res) => {
  res.render('home');
});

server.listen(port, () => {
  console.log(`Pulse is beating alive at port ${port}`);
});