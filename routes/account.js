const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { readUsers, writeUsers } = require('../utils/user');

router.get('/account', (req, res) => {
  const loggedInUser = req.session.user;

  const users = readUsers();
  const currentUser = users.find(u => u.id === loggedInUser.id);

  if (!currentUser) {
    req.session.destroy(() => {
      res.redirect('/login');
    });
    return;
  }
  let successMessage = null;
  if (req.query.success === 'usernameUpdated') {
    successMessage = 'Username updated successfully!';
  } else if (req.query.success === 'emailUpdated') {
    successMessage = 'Email updated successfully!';
  } else if (req.query.success === 'passwordUpdated') {
    successMessage = 'Password updated successfully!';
  } else if (req.query.success === 'profilePictureUpdated') {
    successMessage = 'Profile picture updated successfully!';
  }

  res.render('account', { user: currentUser, error: null, success: successMessage });
});

router.post('/account/username', (req, res) => {
  const { username } = req.body;
  const loggedInUser = req.session.user;

  if (!loggedInUser) {
    return res.redirect('/login');
  }
  if (!username || username.trim() === '') {
    return res.status(400).render('account', { user: loggedInUser, error: 'Username cannot be empty.' });
  }

  let users = readUsers();
  const userIndex = users.findIndex(u => u.id === loggedInUser.id);

  if (userIndex !== -1) {
    const usernameExists = users.some(u => u.username.toLowerCase() === username.toLowerCase() && u.id !== loggedInUser.id);
    if (usernameExists) {
      return res.status(409).render('account', { user: loggedInUser, error: 'Username already taken by another account.' });
    }

    users[userIndex].username = username;
    writeUsers(users);

    req.session.user.username = username;
    res.redirect('/account?success=usernameUpdated');
  } else {
    req.session.destroy(() => {
      res.redirect('/login');
    });
  }
});

router.post('/account/email', (req, res) => {
  const { email } = req.body;
  const loggedInUser = req.session.user;

  if (!loggedInUser) {
    return res.redirect('/login');
  }
  if (!email || !email.includes('@') || !email.includes('.')) { 
    return res.status(400).render('account', { user: loggedInUser, error: 'Please enter a valid email address.' });
  }

  let users = readUsers();
  const userIndex = users.findIndex(u => u.id === loggedInUser.id);

  if (userIndex !== -1) {
    const emailExists = users.some(u => u.email === email && u.id !== loggedInUser.id);
    if (emailExists) {
      return res.status(409).render('account', { user: loggedInUser, error: 'Email already in use by another account.' });
    }

    users[userIndex].email = email;
    writeUsers(users);

    req.session.user.email = email;
    res.redirect('/account?success=emailUpdated');
  } else {
    req.session.destroy(() => { 
      res.redirect('/login');
    });
  }
});

router.post('/account/password', async (req, res) => {
  const { currentPassword, newPassword, repeatNewPassword } = req.body;
  const loggedInUser = req.session.user;

  if (!loggedInUser) {
    return res.redirect('/login');
  }
  if (!currentPassword || !newPassword || !repeatNewPassword) {
    return res.status(400).render('account', { user: loggedInUser, error: 'All password fields are required.' });
  }
  if (newPassword !== repeatNewPassword) {
    return res.status(400).render('account', { user: loggedInUser, error: 'New passwords do not match.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).render('account', { user: loggedInUser, error: 'New password must be at least 6 characters long.' });
  }

  let users = readUsers();
  const userIndex = users.findIndex(u => u.id === loggedInUser.id);

  if (userIndex !== -1) {
    const currentUser = users[userIndex];

    const isPasswordValid = await bcrypt.compare(currentPassword, currentUser.password);
    if (!isPasswordValid) {
      return res.status(401).render('account', { user: loggedInUser, error: 'Incorrect current password.' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    users[userIndex].password = hashedNewPassword;
    writeUsers(users);

    res.redirect('/account?success=passwordUpdated');
  } else {
    req.session.destroy(() => { 
      res.redirect('/login');
    });
  }
});

router.post('/account/profilepicture', (req, res) => {
  const { profilepicture } = req.body;
  const loggedInUser = req.session.user;

  if (!loggedInUser) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  if (!profilepicture || typeof profilepicture !== 'string') {
    return res.status(400).json({ error: 'Invalid profile picture URL.' });
  }

  let users = readUsers();
  const userIndex = users.findIndex(u => u.id === loggedInUser.id);

  if (userIndex !== -1) {
    users[userIndex].profilepicture = profilepicture;
    writeUsers(users);

    req.session.user.profilepicture = profilepicture;
    return res.status(200).json({ message: 'Profile picture updated successfully!' });
  } else {
    req.session.destroy(() => {
      res.status(404).json({ error: 'User not found.' });
    });
  }
});

module.exports = router;