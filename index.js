require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io'); 
const createAuthRouter = require('./modules/auth');
const createAnnouncementsRouter = require('./modules/announcements');
const createAdminRouter = require('./modules/admin');
const createFriendsRouter = require('./modules/friends');
const createDmRouter = require('./modules/dm');
const { startCli } = require('./modules/cli');
const session = require('express-session');
const createSettingsRouter = require('./modules/settings');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
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
pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
});

pool.connect()
    .then(client => {
        console.log('Database connected');
        client.on('error', (err) => {
            console.error('Unhandled error on client', err);
        });
        client.release();
    })
    .catch(err => console.error('Database connection error', err.stack));
app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/others', express.static('others'));
app.use('/uploads', express.static('uploads')); 
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'pulse',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
});
app.use(sessionMiddleware);
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));
io.on('connection', (socket) => {
    const session = socket.request.session;
    if (session && session.userId) {
        const userId = session.userId;
        socket.join(`user_${userId}`);
        console.log(`User ${userId} connected to socket room.`);
    }
    socket.on('disconnect', () => {
    });
});
app.use((req, res, next) => {
    if (!req.session.csrfSecret) {
        req.session.csrfSecret = crypto.randomBytes(100).toString('base64');
    }
    res.locals.csrfToken = req.session.csrfSecret;
    if (req.method === 'POST' && !req.path.startsWith('/uploads') && !(req.headers['content-type'] && req.headers['content-type'].startsWith('multipart/form-data'))) {
        const csrfToken = req.body._csrf || req.headers['x-csrf-token'];
        console.log(`CSRF Check: Provided Token = ${csrfToken}, Session Secret = ${req.session.csrfSecret}, Path = ${req.path}`);
        if (!csrfToken || csrfToken !== req.session.csrfSecret) {
            return res.status(403).json({ error: 'CSRF token missing or invalid.' });
        }
    }
    next();
});
const { router: authRouter, isAuthenticated } = createAuthRouter(pool, bcrypt, saltRounds);
const announcementsRouter = createAnnouncementsRouter(pool);
const friendsRouter = createFriendsRouter(pool, isAuthenticated);
const dmRouter = createDmRouter(pool, isAuthenticated, io);
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
                const friendsResult = await pool.query(
                    `SELECT u.id, u.username, u.profile_picture
                    FROM users u
                    JOIN friendships f ON (u.id = f.user_id1 AND f.user_id2 = $1) OR (u.id = f.user_id2 AND f.user_id1 = $1)
                    WHERE u.id != $1`,
                    [req.session.userId]
                );
                user.friends = friendsResult.rows.map(friend => {
                    if (process.env.NIMBUS_URL && friend.profile_picture) {
                        if (friend.profile_picture === '/others/default_avatar.png') {
                            friend.profile_picture = `${process.env.NIMBUS_URL}/cdn/profile/default_avatar.png`;
                        } else if (friend.profile_picture.startsWith('/cdn/profile/')) {
                            friend.profile_picture = `${process.env.NIMBUS_URL}${friend.profile_picture}`;
                        }
                    }
                    return friend;
                });
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
app.use('/api/friends', friendsRouter);
app.use('/dm', dmRouter);
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
        res.render('admin/dashboard', { request: req, userCount: userCount, latestUpdates: [] });
    } catch (error) {
        console.error('Error fetching data for admin dashboard:', error);
        res.status(500).send('Internal Server Error');
    }
});
app.get('/dashboard', isAuthenticated, (req, res) => {
    res.render('dashboard', { request: req });
});
app.get('/friends', isAuthenticated, (req, res) => {
    res.render('friends', { request: req, csrfToken: req.session.csrfSecret });
});
app.use('/settings', createSettingsRouter(pool, isAuthenticated, bcrypt, saltRounds, process.env.NIMBUS_URL, process.env.NIMBUS_API, (req) => req.session.csrfSecret));
server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    startCli(pool);
});