const express = require('express');
const app = express();
const port = 3000;
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

// Load messages from file on server startup
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
  secret: 'your-secret-key',
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
  });

  socket.on('chat message', (msg) => {
    const { senderId, receiverId, type, content } = msg;

    let encryptedContent = content;
    if (type === 'text') {
      const secretKey = 'my-secret-key';
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

app.set('io', io);

app.get('/', (req, res) => {
  res.render('home');
});

server.listen(port, () => {
  console.log(`Pulse is beating alive at port ${port}`);
});