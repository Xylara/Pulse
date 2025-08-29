const express = require('express');
const app = express();
const port = 3000;
const expressSession = require('express-session');
const bodyparser = require('body-parser');
const { readUsers } = require('./utils/user');
const userRoutes = require('./routes/user');
const dashboardRoutes = require('./routes/dashboard');
const authMiddleware = require('./middleware/auth');

app.set('view engine', 'ejs');

app.use(express.static('public'));

app.use('/others', express.static('others'));

app.use(bodyparser.urlencoded({ extended: false }));
app.use(expressSession({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true
}));

app.use('/', userRoutes);
app.use('/dashboard', authMiddleware, dashboardRoutes);

app.get('/', (req, res) => {
  res.render('home');
});

app.listen(port, () => {
  console.log(`Pulse is beating alive at port ${port}`);
});