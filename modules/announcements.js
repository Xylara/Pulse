const express = require('express');
const router = express.Router();

function createAnnouncementsRouter(pool) {

    function isAdmin(req, res, next) {
        if (req.session.user && req.session.user.isadmin === 'yes') {
            return next();
        }
        res.status(403).send('Access Denied: Admins only.');
    }

    router.get('/', isAdmin, async (req, res) => {
        try {
            const result = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
            res.json(result.rows);
        } catch (err) {
            console.error('Error fetching announcements:', err);
            res.status(500).json({ error: 'Server error fetching announcements.' });
        }
    });

    router.post('/', isAdmin, async (req, res) => {
        const { title, content } = req.body;
        if (!title || !content) {
            return res.status(400).json({ error: 'Title and content are required.' });
        }

        try {
            const result = await pool.query(
                'INSERT INTO announcements (title, content) VALUES ($1, $2) RETURNING *',
                [title, content]
            );
            res.status(201).json(result.rows[0]);
        } catch (err) {
            console.error('Error creating announcement:', err);
            res.status(500).json({ error: 'Server error creating announcement.' });
        }
    });

    router.get('/latest', async (req, res) => {
        try {
            const result = await pool.query('SELECT title, content FROM announcements ORDER BY created_at DESC LIMIT 1');
            if (result.rows.length > 0) {
                res.json(result.rows[0]);
            } else {
                res.status(404).json({ error: 'No announcements found.' });
            }
        } catch (err) {
            console.error('Error fetching latest announcement:', err);
            res.status(500).json({ error: 'Server error fetching latest announcement.' });
        }
    });

    return router;
}

module.exports = createAnnouncementsRouter;