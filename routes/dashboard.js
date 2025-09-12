const express = require('express');
const router = express.Router();
const { readUsers, writeUsers } = require('../utils/user');

router.get('/', (req, res) => {
  const message = req.session.message;
  delete req.session.message;
  res.render('dashboard', { user: req.session.user, message: message });
});

router.get('/dashboard', (req, res) => {
  res.render('parts/sidebar', { currentPath: req.path });
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

router.post('/add-friend', (req, res) => {
  const { friendUsername } = req.body;
  const currentUser = req.session.user;

  if (!friendUsername) {
    req.session.message = { type: 'error', text: 'Friend username cannot be empty.' };
    return res.redirect('/dashboard');
  }

  if (friendUsername === currentUser.username) {
    req.session.message = { type: 'error', text: 'You cannot send a friend request to yourself.' };
    return res.redirect('/dashboard');
  }

  let users = readUsers();
  const targetFriend = users.find(u => u.username === friendUsername);

  if (!targetFriend) {
    req.session.message = { type: 'error', text: 'User not found.' };
    return res.redirect('/dashboard');
  }

  const currentUserIndex = users.findIndex(u => u.id === currentUser.id);
  const targetFriendIndex = users.findIndex(u => u.id === targetFriend.id);

  if (!users[currentUserIndex].friends) users[currentUserIndex].friends = [];
  if (!users[currentUserIndex].sentFriendRequests) users[currentUserIndex].sentFriendRequests = [];
  if (!users[currentUserIndex].receivedFriendRequests) users[currentUserIndex].receivedFriendRequests = [];

  if (!users[targetFriendIndex].friends) users[targetFriendIndex].friends = [];
  if (!users[targetFriendIndex].sentFriendRequests) users[targetFriendIndex].sentFriendRequests = [];
  if (!users[targetFriendIndex].receivedFriendRequests) users[targetFriendIndex].receivedFriendRequests = [];


  if (users[currentUserIndex].friends.includes(targetFriend.username)) {
    req.session.message = { type: 'warning', text: `${friendUsername} is already your friend.` };
    return res.redirect('/dashboard');
  }

  if (users[currentUserIndex].sentFriendRequests.includes(targetFriend.username)) {
    req.session.message = { type: 'warning', text: `You have already sent a friend request to ${friendUsername}.` };
    return res.redirect('/dashboard');
  }

  if (users[currentUserIndex].receivedFriendRequests.includes(targetFriend.username)) {
    req.session.message = { type: 'info', text: `${friendUsername} has already sent you a friend request. You can accept it below!` };
    return res.redirect('/dashboard');
  }

  users[currentUserIndex].sentFriendRequests.push(targetFriend.username);
  users[targetFriendIndex].receivedFriendRequests.push(currentUser.username);

  writeUsers(users);

  req.session.user.sentFriendRequests = users[currentUserIndex].sentFriendRequests;

  req.session.message = { type: 'success', text: `Friend request sent to ${friendUsername}.` };
  res.redirect('/dashboard');
});


router.post('/accept-friend-request', (req, res) => {
  const { requesterUsername } = req.body;
  const currentUser = req.session.user;

  let users = readUsers();
  const currentUserIndex = users.findIndex(u => u.id === currentUser.id);
  const requesterIndex = users.findIndex(u => u.username === requesterUsername);

  if (currentUserIndex === -1 || requesterIndex === -1) {
    req.session.message = { type: 'error', text: 'An error occurred. User not found.' };
    return res.redirect('/dashboard');
  }

  if (!users[currentUserIndex].friends) users[currentUserIndex].friends = [];
  if (!users[currentUserIndex].receivedFriendRequests) users[currentUserIndex].receivedFriendRequests = [];
  if (!users[requesterIndex].friends) users[requesterIndex].friends = [];
  if (!users[requesterIndex].sentFriendRequests) users[requesterIndex].sentFriendRequests = [];

  const receivedRequestIndex = users[currentUserIndex].receivedFriendRequests.indexOf(requesterUsername);
  if (receivedRequestIndex === -1) {
    req.session.message = { type: 'error', text: `No friend request from ${requesterUsername} found.` };
    return res.redirect('/dashboard');
  }

  users[currentUserIndex].receivedFriendRequests.splice(receivedRequestIndex, 1);
  const sentRequestIndex = users[requesterIndex].sentFriendRequests.indexOf(currentUser.username);
  if (sentRequestIndex !== -1) { 
    users[requesterIndex].sentFriendRequests.splice(sentRequestIndex, 1);
  }

  users[currentUserIndex].friends.push(requesterUsername);
  users[requesterIndex].friends.push(currentUser.username);

  writeUsers(users);

  req.session.user.friends = users[currentUserIndex].friends;
  req.session.user.receivedFriendRequests = users[currentUserIndex].receivedFriendRequests;

  req.session.message = { type: 'success', text: `You are now friends with ${requesterUsername}!` };
  res.redirect('/dashboard');
});

router.post('/reject-friend-request', (req, res) => {
  const { requesterUsername } = req.body;
  const currentUser = req.session.user;

  let users = readUsers();
  const currentUserIndex = users.findIndex(u => u.id === currentUser.id);
  const requesterIndex = users.findIndex(u => u.username === requesterUsername);

  if (currentUserIndex === -1 || requesterIndex === -1) {
    req.session.message = { type: 'error', text: 'An error occurred. User not found.' };
    return res.redirect('/dashboard');
  }

  if (!users[currentUserIndex].receivedFriendRequests) users[currentUserIndex].receivedFriendRequests = [];
  if (!users[requesterIndex].sentFriendRequests) users[requesterIndex].sentFriendRequests = [];

  const receivedRequestIndex = users[currentUserIndex].receivedFriendRequests.indexOf(requesterUsername);
  if (receivedRequestIndex === -1) {
    req.session.message = { type: 'error', text: `No friend request from ${requesterUsername} found to reject.` };
    return res.redirect('/dashboard');
  }

  users[currentUserIndex].receivedFriendRequests.splice(receivedRequestIndex, 1);
  const sentRequestIndex = users[requesterIndex].sentFriendRequests.indexOf(currentUser.username);
  if (sentRequestIndex !== -1) {
    users[requesterIndex].sentFriendRequests.splice(sentRequestIndex, 1);
  }

  writeUsers(users);

  req.session.user.receivedFriendRequests = users[currentUserIndex].receivedFriendRequests;

  req.session.message = { type: 'info', text: `Friend request from ${requesterUsername} rejected.` };
  res.redirect('/dashboard');
});


module.exports = router;