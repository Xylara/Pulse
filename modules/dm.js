const express = require('express');
const { marked } = require('marked'); 
module.exports = (pool, isAuthenticated, io) => {
    const router = express.Router();
    router.get('/:username', isAuthenticated, async (req, res) => {
        try {
            const userId = req.session.userId;
            const { username } = req.params;
            const friendResult = await pool.query('SELECT id, public_key FROM users WHERE username = $1', [username]);
            if (friendResult.rows.length === 0) {
                return res.status(404).render('404', { request: req, message: 'Friend not found.' });
            }
            const friendData = friendResult.rows[0];
            const friendId = friendData.id;
            const friendPublicKey = friendData.public_key; 
            const friendshipCheck = await pool.query(
                `SELECT * FROM friendships
                WHERE (user_id1 = $1 AND user_id2 = $2) OR (user_id1 = $2 AND user_id2 = $1)`,
                [userId, friendId]
            );
            if (friendshipCheck.rows.length === 0) {
                return res.status(403).render('403', { request: req, message: 'You are not friends with this user.' });
            }
            const currentUserResult = await pool.query('SELECT username, profile_picture, public_key FROM users WHERE id = $1', [userId]);
            const currentUser = currentUserResult.rows[0];
            const messagesResult = await pool.query(
                `SELECT
                    dm.id,
                    dm.sender_id,
                    dm.receiver_id,
                    dm.content,
                    dm.timestamp,
                    users.username AS sender_username,
                    users.profile_picture AS sender_profile_picture
                FROM direct_messages dm
                JOIN users ON dm.sender_id = users.id
                WHERE (dm.sender_id = $1 AND dm.receiver_id = $2)
                   OR (dm.sender_id = $2 AND dm.receiver_id = $1)
                ORDER BY dm.timestamp ASC`,
                [userId, friendId]
            );
            res.render('dm', {
                request: req,
                friendUsername: username,
                friendId: friendId,
                friendPublicKey: friendPublicKey, 
                messages: messagesResult.rows, 
                currentUser: currentUser,
                csrfToken: req.session.csrfSecret,
                marked: marked
            });
        } catch (error) {
            console.error('Error fetching DM messages:', error);
            res.status(500).render('error', { request: req, message: 'Internal Server Error' });
        }
    });
    router.post('/:username/send', isAuthenticated, async (req, res) => {
        try {
            const userId = req.session.userId;
            const { username } = req.params;
            const { content: encryptedContent } = req.body; 
            const friendResult = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
            if (friendResult.rows.length === 0) {
                return res.status(404).json({ error: 'Friend not found.' });
            }
            const friendId = friendResult.rows[0].id;
            const insertResult = await pool.query(
                'INSERT INTO direct_messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING timestamp',
                [userId, friendId, encryptedContent]
            );
            const timestamp = insertResult.rows[0].timestamp;
            const senderResult = await pool.query('SELECT username, profile_picture FROM users WHERE id = $1', [userId]);
            const sender = senderResult.rows[0];
            io.to(`user_${friendId}`).emit('receive_message', {
                sender_id: userId,
                sender_username: sender.username,
                sender_profile_picture: sender.profile_picture,
                content: encryptedContent, 
                timestamp: timestamp
            });
            res.status(200).json({ message: 'Encrypted message sent.' });
        } catch (error) {
            console.error('Error sending DM:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });
    router.post('/api/save-public-key', isAuthenticated, async (req, res) => {
        try {
            const userId = req.session.userId;
            const { publicKey } = req.body;
            await pool.query('UPDATE users SET public_key = $1 WHERE id = $2', [publicKey, userId]);
            res.json({ success: true });
        } catch (error) {
            console.error("Error saving public key:", error);
            res.status(500).json({ error: "Failed to save key" });
        }
    });
    return router;
};