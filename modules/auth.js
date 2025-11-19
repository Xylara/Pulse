const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const BASE_URL = process.env.BASE_URL.replace(/\/$/, '');
const EMAIL_FROM = process.env.EMAIL_FROM;

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_PORT == 465,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

async function sendVerificationEmail(toEmail, verificationLink) {
    const mailOptions = {
        from: EMAIL_FROM,
        to: toEmail,
        subject: 'Verify Your Email Address',
        html: `
            <p>Thank you for registering. Please click the link below to verify your email address:</p>
            <p><a href="${verificationLink}">${verificationLink}</a></p>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Verification email sent to ${toEmail}`);
    } catch (error) {
        console.error(`Error sending verification email to ${toEmail}:`, error);
    }
}

function createAuthRouter(pool, bcrypt, saltRounds) {

    function isAuthenticated(req, res, next) {
        if (!req.session.userId) {
            return res.redirect('/');
        }

        if (config['email-verification']) {
            pool.query('SELECT is_verified FROM users WHERE id = $1', [req.session.userId])
                .then(result => {
                    const user = result.rows[0];
                    if (user && user.is_verified === 'yes') {
                        return next();
                    } else {
                        return res.render('login', { error: 'Access denied. Please verify your email.' });
                    }
                })
                .catch(err => {
                    console.error('Verification check error:', err);
                    res.status(500).render('login', { error: 'Server error during verification check.' });
                });
        } else {
            return next();
        }
    }

    router.get('/', (req, res) => {
        if (req.session.userId) {
            return res.redirect('/dashboard');
        }
        res.render('login', { error: null });
    });

    router.get('/register', (req, res) => {
        res.render('register', { error: null });
    });

    router.post('/register', async (req, res) => {
        const { email, username, password, repeat_password } = req.body;

        if (password !== repeat_password) {
            return res.render('register', { error: 'Passwords dont match.' });
        }

        const disallowedChars = /[<>"'&]/;
        if (disallowedChars.test(username)) {
            return res.status(400).render('register', { error: 'Username contains disallowed characters: <, >, ", \', &.' });
        }

        try {
            const userCheck = await pool.query('SELECT * FROM users WHERE email = $1 OR username = $2', [email, username]);
            if (userCheck.rows.length > 0) {
                return res.render('register', { error: 'Email or username already exists.' });
            }

            const hashedPassword = await bcrypt.hash(password, saltRounds);

            const isVerified = config['email-verification'] ? 'no' : 'yes';
            const verificationToken = isVerified === 'no' ? crypto.randomBytes(32).toString('hex') : null;

            const cdnDefaultAvatar = `${process.env.NIMBUS_URL}/cdn/profile/default_avatar.png`;
            const result = await pool.query(
                'INSERT INTO users (email, username, password_hash, is_verified, verification_token, profile_picture) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
                [email, username, hashedPassword, isVerified, verificationToken, cdnDefaultAvatar]
            );

            if (isVerified === 'no') {
                const verificationLink = `${BASE_URL}/verify/${verificationToken}`;
                await sendVerificationEmail(email, verificationLink);
                return res.render('register', { error: 'Registration successful. Please check your email for the verification link.' });
            }

            res.redirect('/');

        } catch (err) {
            console.error('error:', err);
            res.status(500).render('register', { error: 'Server error.' });
        }
    });

    router.post('/login', async (req, res) => {
        const { username, password } = req.body;

        try {
            const userResult = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);
            const user = userResult.rows[0];

            if (!user) {
                return res.render('login', { error: 'Invalid username or password.' });
            }

            if (config['email-verification'] && user.is_verified === 'no') {
                return res.render('login', { error: 'Account not verified. Please check your email for the verification link.' });
            }

            const passwordMatch = await bcrypt.compare(password, user.password_hash);

            if (passwordMatch) {
                req.session.userId = user.id;
                req.session.user = user;
                res.redirect('/dashboard');
            } else {
                res.render('login', { error: 'Invalid username or password.' });
            }

        } catch (err) {
            console.error('error:', err);
            res.status(500).render('login', { error: 'Server error.' });
        }
    });

    router.get('/verify/:token', async (req, res) => {
        const { token } = req.params;

        try {
            const result = await pool.query(
                'UPDATE users SET is_verified = $1, verification_token = NULL WHERE verification_token = $2 RETURNING id',
                ['yes', token]
            );

            if (result.rows.length === 0) {
                return res.render('login', { error: 'Invalid or expired verification link.' });
            }

            res.render('login', { error: 'Email successfully verified. Please log in.' });

        } catch (err) {
            console.error('Verification error:', err);
            res.status(500).render('login', { error: 'Server error during verification.' });
        }
    });

    return { router, isAuthenticated };
}

module.exports = createAuthRouter;