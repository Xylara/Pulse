const express = require('express');
const router = express.Router();

function createAuthRouter(pool, bcrypt, saltRounds) {

    router.get('/', (req, res) => {
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

            const result = await pool.query(
                'INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id',
                [email, username, hashedPassword]
            );

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

            const passwordMatch = await bcrypt.compare(password, user.password_hash);

            if (passwordMatch) {
                res.redirect('/dashboard');
            } else {
                res.render('login', { error: 'Invalid username or password.' });
            }

        } catch (err) {
            console.error('error:', err);
            res.status(500).render('login', { error: 'Server error.' });
        }
    });

    return router;
}

module.exports = createAuthRouter;