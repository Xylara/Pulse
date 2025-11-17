require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const express = require('express');
const createAuthRouter = require('./modules/auth');
const { startCli } = require('./modules/cli');
const session = require('express-session');

const app = express();
const port = 3000;
const saltRounds = 10;

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: {
        rejectUnauthorized: false,
    },
});

pool.connect()
    .then(() => console.log('Database connected'))
    .catch(err => console.error('error', err.stack));

app.set('view engine', 'ejs');

app.use(express.urlencoded({ extended: true }));

app.use('/others', express.static('others'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'pulse',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

const { router: authRouter, isAuthenticated } = createAuthRouter(pool, bcrypt, saltRounds);

app.use((req, res, next) => {
    res.locals.user = req.session.user;
    next();
});
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.isadmin && req.session.user.isadmin.toLowerCase() === 'yes') {
        next();
    } else {
        res.status(403).send('Access Denied: Admins only.');
    }
};

app.use('/', authRouter);

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Logout error:', err);
        }
app.get('/admin', isAuthenticated, isAdmin, (req, res) => {
    res.send('Admin Dashboard');
});

        res.redirect('/');
    });
});

app.get('/dashboard', isAuthenticated, (req, res) => {
    res.render('dashboard', { request: req });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    startCli(pool);
});