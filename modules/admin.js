const express = require('express');
const https = require('https');

function createAdminRouter(pool, isAuthenticated, isAdmin, bcrypt, saltRounds) {
    const router = express.Router();

    async function fetchAllUsers() {
        try {

            const result = await pool.query('SELECT id, username, email, isadmin, is_verified FROM users ORDER BY id ASC');

            return result.rows.map(user => ({
                id: user.id,
                username: user.username,
                email: user.email,
                is_admin: user.isadmin && user.isadmin.toLowerCase() === 'yes',
                is_verified: user.is_verified && user.is_verified.toLowerCase() === 'yes'
            }));
        } catch (error) {
            console.error('Error fetching all users:', error);
            return [];
        }
    }

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

    router.use(isAuthenticated, isAdmin);

    router.get('/', async (req, res) => {
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

    router.get('/announcements', (req, res) => {
        res.render('admin/announcements', { request: req });
    });

    router.get('/users', async (req, res) => {
        const users = await fetchAllUsers();
        res.render('admin/users', { request: req, users: users });
    });

    router.get('/users/:id/toggle-admin', async (req, res) => {
        const userId = req.params.id;
        try {

            const currentStatusResult = await pool.query('SELECT isadmin FROM users WHERE id = $1', [userId]);
            if (currentStatusResult.rows.length === 0) {
                return res.status(404).send('User not found');
            }
            const currentStatus = currentStatusResult.rows[0].isadmin && currentStatusResult.rows[0].isadmin.toLowerCase() === 'yes';
            const newStatus = currentStatus ? 'no' : 'yes';

            await pool.query('UPDATE users SET isadmin = $1 WHERE id = $2', [newStatus, userId]);

            if (req.session.user && req.session.user.id == userId) {
                req.session.user.isadmin = newStatus;
            }

            res.redirect('/admin/users');
        } catch (error) {
            console.error('Error toggling admin status:', error);
            res.status(500).send('Internal Server Error');
        }
    });

    router.get('/users/:id/toggle-verified', async (req, res) => {
        const userId = req.params.id;
        try {

            const currentStatusResult = await pool.query('SELECT is_verified FROM users WHERE id = $1', [userId]);
            if (currentStatusResult.rows.length === 0) {
                return res.status(404).send('User not found');
            }
            const currentStatus = currentStatusResult.rows[0].is_verified && currentStatusResult.rows[0].is_verified.toLowerCase() === 'yes';
            const newStatus = currentStatus ? 'no' : 'yes';

            await pool.query('UPDATE users SET is_verified = $1 WHERE id = $2', [newStatus, userId]);

            if (req.session.user && req.session.user.id == userId) {
                req.session.user.is_verified = newStatus;
            }

            res.redirect('/admin/users');
        } catch (error) {
            console.error('Error toggling verified status:', error);
            res.status(500).send('Internal Server Error');
        }
    });

    router.get('/users/:id/delete', async (req, res) => {
        const userId = req.params.id;

        if (req.session.user && req.session.user.id == userId) {
            return res.status(403).send('Cannot delete your own account from the admin panel.');
        }

        try {
            await pool.query('DELETE FROM users WHERE id = $1', [userId]);
            res.redirect('/admin/users');
        } catch (error) {
            console.error('Error deleting user:', error);
            res.status(500).send('Internal Server Error');
        }
    });

    router.post('/users/update-username', async (req, res) => {
        const { id, username } = req.body;
        const disallowedChars = /[<>"'&]/;

        if (disallowedChars.test(username)) {
            return res.redirect('/admin/users?error=' + encodeURIComponent('Username contains disallowed characters: <, >, ", \', &.'));
        }

        try {

            const userCheck = await pool.query('SELECT id FROM users WHERE username = $1 AND id != $2', [username, id]);
            if (userCheck.rows.length > 0) {
                return res.redirect('/admin/users?error=' + encodeURIComponent('Username already exists.'));
            }

            await pool.query('UPDATE users SET username = $1 WHERE id = $2', [username, id]);

            if (req.session.user && req.session.user.id == id) {
                req.session.user.username = username;
            }

            res.redirect('/admin/users?success=' + encodeURIComponent('Username updated successfully.'));
        } catch (error) {
            console.error('Error updating username:', error);
            res.redirect('/admin/users?error=' + encodeURIComponent('Server error updating username.'));
        }
    });

    router.post('/users/change-password', async (req, res) => {
        const { id, password, repeat_password } = req.body;

        if (password !== repeat_password) {
            return res.redirect('/admin/users?error=' + encodeURIComponent('Passwords do not match.'));
        }

        try {
            const hashedPassword = await bcrypt.hash(password, saltRounds);
            await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, id]);
            res.redirect('/admin/users?success=' + encodeURIComponent('Password changed successfully.'));
        } catch (error) {
            console.error('Error changing password:', error);
            res.redirect('/admin/users?error=' + encodeURIComponent('Server error changing password.'));
        }
    });

    return router;
}

module.exports = createAdminRouter;