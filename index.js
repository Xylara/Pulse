require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const express = require('express');
const createAuthRouter = require('./modules/auth');
const createAnnouncementsRouter = require('./modules/announcements');
const createAdminRouter = require('./modules/admin');
const { startCli } = require('./modules/cli');
const session = require('express-session');
const https = require('https');

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

app.use(session({
    secret: process.env.SESSION_SECRET || 'pulse',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

const { router: authRouter, isAuthenticated } = createAuthRouter(pool, bcrypt, saltRounds);
const announcementsRouter = createAnnouncementsRouter(pool);

app.use((req, res, next) => {
    res.locals.user = req.session.user;
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
const fetchLatestCommits = () => {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: '/repos/Xylara/Pulse/commits?per_page=5',
            method: 'GET',
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Pulse-Admin-Dashboard'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode !== 200) {
                    console.error(`GitHub API error: ${res.statusCode} ${res.statusMessage}`);
                    return resolve([]);
                }
                try {
                    const commits = JSON.parse(data);
                    const formattedCommits = commits.map(commit => ({
                        sha: commit.sha.substring(0, 7),
                        message: commit.commit.message.split('\n')[0],
                        author: commit.commit.author.name,
                        date: new Date(commit.commit.author.date).toLocaleDateString(),
                        url: commit.html_url
                    }));
                    resolve(formattedCommits);
                } catch (e) {
                    console.error('Error parsing GitHub API response:', e);
                    resolve([]);
                }
            });
        });

        req.on('error', (e) => {
            console.error('Error fetching latest commits:', e);
            resolve([]);
        });

        req.end();
    });
};

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

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    startCli(pool);
});