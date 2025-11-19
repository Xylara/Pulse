require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const express = require('express');
const createAuthRouter = require('./modules/auth');
const createAnnouncementsRouter = require('./modules/announcements');
const createAdminRouter = require('./modules/admin');
const { startCli } = require('./modules/cli');
const session = require('express-session');
const createSettingsRouter = require('./modules/settings');

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/others', express.static('others'));
app.use('/uploads', express.static('uploads')); 

app.use(session({
    secret: process.env.SESSION_SECRET || 'pulse',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

const { router: authRouter, isAuthenticated } = createAuthRouter(pool, bcrypt, saltRounds);
const announcementsRouter = createAnnouncementsRouter(pool);

app.use(async (req, res, next) => {
    if (req.session.userId) {
        try {
            const userResult = await pool.query('SELECT id, email, username, profile_picture, isadmin, is_verified FROM users WHERE id = $1', [req.session.userId]);
            if (userResult.rows.length > 0) {
                const user = userResult.rows[0];
                if (process.env.NIMBUS_URL && user.profile_picture) {
                    if (user.profile_picture === '/others/default_avatar.png') {
                        user.profile_picture = `${process.env.NIMBUS_URL}/cdn/profile/default_avatar.png`;
                    } else if (user.profile_picture.startsWith('/cdn/profile/')) {
                        user.profile_picture = `${process.env.NIMBUS_URL}${user.profile_picture}`;
                    }
                }
                res.locals.user = user;
                req.session.user = user;
            }
        } catch (error) {
            console.error('Error fetching user data for middleware:', error);
        }
    }
    next();
});
const isAdmin = (req, res, next) => {
    if (req.session.user && (req.session.user.isadmin?.toLowerCase() === 'yes')) {
        next();
    } else {
        res.status(403).send('Access Denied: Admins only.');
    }
};

const adminRouter = createAdminRouter(pool, isAuthenticated, isAdmin, bcrypt, saltRounds);

app.use('/', authRouter);

app.use('/api/announcements', announcementsRouter);

app.use('/admin', adminRouter);

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Logout error:', err);
        }
        res.redirect('/');
    });
});

app.get('/admin', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM users');
        const userCount = result.rows[0].count;
        const latestUpdates = await fetchLatestCommits();
        res.render('admin/dashboard', { request: req, userCount: userCount, latestUpdates: latestUpdates });
    } catch (error) {
        console.error('Error fetching data for admin dashboard:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/dashboard', isAuthenticated, (req, res) => {
    res.render('dashboard', { request: req });
});

app.get('/friends', isAuthenticated, (req, res) => {
    res.render('friends', { request: req });
});

app.use('/settings', createSettingsRouter(pool, isAuthenticated, bcrypt, saltRounds, process.env.NIMBUS_URL, process.env.NIMBUS_API));

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    startCli(pool);
});