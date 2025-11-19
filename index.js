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
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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

app.get('/friends', isAuthenticated, (req, res) => {
    res.render('friends', { request: req });
});

app.get('/settings', isAuthenticated, (req, res) => {
    res.render('settings', { request: req, successMessage: null, errorMessage: null });
});

app.post('/settings/change-username', isAuthenticated, async (req, res) => {
    const { newUsername } = req.body;
    const userId = req.session.user.id;

    if (!newUsername) {
        return res.render('settings', { request: req, errorMessage: 'New username cannot be empty.', successMessage: null });
    }

    try {

        const existingUser = await pool.query('SELECT id FROM users WHERE username = $1', [newUsername]);
        if (existingUser.rows.length > 0) {
            return res.render('settings', { request: req, errorMessage: 'Username already taken.', successMessage: null });
        }

        await pool.query('UPDATE users SET username = $1 WHERE id = $2', [newUsername, userId]);
        req.session.user.username = newUsername; 
        res.render('settings', { request: req, successMessage: 'Username updated successfully!', errorMessage: null });
    } catch (error) {
        console.error('Error changing username:', error);
        res.render('settings', { request: req, errorMessage: 'Failed to update username.', successMessage: null });
    }
});

app.post('/settings/change-password', isAuthenticated, async (req, res) => {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;
    const userId = req.session.user.id;

    if (!currentPassword || !newPassword || !confirmNewPassword) {
        return res.render('settings', { request: req, errorMessage: 'All password fields are required.', successMessage: null });
    }

    if (newPassword !== confirmNewPassword) {
        return res.render('settings', { request: req, errorMessage: 'New passwords do not match.', successMessage: null });
    }

    try {
        const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
            return res.render('settings', { request: req, errorMessage: 'Incorrect current password.', successMessage: null });
        }

        const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPasswordHash, userId]);
        res.render('settings', { request: req, successMessage: 'Password updated successfully!', errorMessage: null });
    } catch (error) {
        console.error('Error changing password:', error);
        res.render('settings', { request: req, errorMessage: 'Failed to update password.', successMessage: null });
    }
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, req.session.userId + path.extname(file.originalname));
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb('Error: Images Only!');
        }
    }
}).single('profilePicture');

app.post('/settings/change-profile-picture', isAuthenticated, (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            console.error('Error uploading file:', err);
            return res.render('settings', { request: req, errorMessage: err, successMessage: null });
        }
        if (!req.file) {
            return res.render('settings', { request: req, errorMessage: 'No file selected.', successMessage: null });
        }

        const userId = req.session.user.id;
        const oldProfilePicture = req.session.user.profile_picture;
        const newProfilePicture = `/uploads/${req.file.filename}`;

        try {
            await pool.query('UPDATE users SET profile_picture = $1 WHERE id = $2', [newProfilePicture, userId]);
            req.session.user.profile_picture = newProfilePicture; 

            if (oldProfilePicture && !oldProfilePicture.startsWith('/others/default_avatar.png')) {
                const oldPath = path.join(__dirname, oldProfilePicture);
                fs.unlink(oldPath, (unlinkErr) => {
                    if (unlinkErr) {
                        console.error('Error deleting old profile picture:', unlinkErr);
                    } else {
                        console.log('Old profile picture deleted:', oldPath);
                    }
                });
            }

            res.render('settings', { request: req, successMessage: 'Profile picture updated successfully!', errorMessage: null });
        } catch (error) {
            console.error('Error updating profile picture in DB:', error);
            res.render('settings', { request: req, errorMessage: 'Failed to update profile picture.', successMessage: null });
        }
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    startCli(pool);
});