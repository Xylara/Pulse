const express = require('express');
module.exports = (pool, isAuthenticated) => {
    const router = express.Router();
    router.get('/list', isAuthenticated, async (req, res) => {
        try {
            const userId = req.session.userId;
            const friendsResult = await pool.query(
                `SELECT u.id, u.username, u.profile_picture
                FROM users u
                JOIN friendships f ON (u.id = f.user_id1 AND f.user_id2 = $1) OR (u.id = f.user_id2 AND f.user_id1 = $1)
                WHERE u.id != $1`,
                [userId]
            );
            const friends = friendsResult.rows;
            res.json({ friends });
        } catch (error) {
            console.error('Error fetching friends:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });
    router.post('/request', isAuthenticated, async (req, res) => {
        try {
            const senderId = req.session.userId;
            const { receiverUsername } = req.body;
            const receiverResult = await pool.query('SELECT id FROM users WHERE username = $1', [receiverUsername]);
            if (receiverResult.rows.length === 0) {
                return res.status(200).json({ message: 'Friend request processed (if user exists and is not already friends).' });
            }
            const receiverId = receiverResult.rows[0].id;
            if (senderId === receiverId) {
                return res.status(200).json({ message: 'Friend request processed (if user exists and is not already friends).' });
            }
            const friendshipCheck = await pool.query(
                `SELECT * FROM friendships
                WHERE (user_id1 = $1 AND user_id2 = $2) OR (user_id1 = $2 AND user_id2 = $1)`,
                [senderId, receiverId]
            );
            if (friendshipCheck.rows.length > 0) {
                return res.status(200).json({ message: 'Friend request processed (if user exists and is not already friends).' });
            }
            const existingRequestCheck = await pool.query(
                `SELECT * FROM friend_requests
                WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
                AND status = 'pending'`,
                [senderId, receiverId]
            );
            if (existingRequestCheck.rows.length > 0) {
                return res.status(200).json({ message: 'Friend request processed (if user exists and is not already friends).' });
            }
            await pool.query(
                'INSERT INTO friend_requests (sender_id, receiver_id) VALUES ($1, $2)',
                [senderId, receiverId]
            );
            res.status(200).json({ message: 'Friend request sent successfully.' });
        } catch (error) {
            console.error('Error sending friend request:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });
    router.get('/requests', isAuthenticated, async (req, res) => {
        try {
            const userId = req.session.userId;
            const incomingRequestsResult = await pool.query(
                `SELECT fr.id, u.id as sender_id, u.username as sender_username, u.profile_picture as sender_profile_picture, fr.created_at
                FROM friend_requests fr
                JOIN users u ON fr.sender_id = u.id
                WHERE fr.receiver_id = $1 AND fr.status = 'pending'`,
                [userId]
            );
            const outgoingRequestsResult = await pool.query(
                `SELECT fr.id, u.id as receiver_id, u.username as receiver_username, u.profile_picture as receiver_profile_picture, fr.created_at
                FROM friend_requests fr
                JOIN users u ON fr.receiver_id = u.id
                WHERE fr.sender_id = $1 AND fr.status = 'pending'`,
                [userId]
            );
            res.json({
                incomingRequests: incomingRequestsResult.rows,
                outgoingRequests: outgoingRequestsResult.rows
            });
        } catch (error) {
            console.error('Error fetching friend requests:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });
    router.post('/requests/accept/:requestId', isAuthenticated, async (req, res) => {
        try {
            const userId = req.session.userId;
            const { requestId } = req.params;
            const requestResult = await pool.query(
                'SELECT sender_id, receiver_id FROM friend_requests WHERE id = $1 AND receiver_id = $2 AND status = \'pending\'',
                [requestId, userId]
            );
            if (requestResult.rows.length === 0) {
                return res.status(404).json({ error: 'Friend request not found or not pending.' });
            }
            const { sender_id, receiver_id } = requestResult.rows[0];
            await pool.query('BEGIN');
            await pool.query(
                'UPDATE friend_requests SET status = \'accepted\' WHERE id = $1',
                [requestId]
            );
            await pool.query(
                'INSERT INTO friendships (user_id1, user_id2) VALUES ($1, $2)',
                [sender_id, receiver_id]
            );
            await pool.query('COMMIT');
            res.status(200).json({ message: 'Friend request accepted.' });
        } catch (error) {
            await pool.query('ROLLBACK');
            console.error('Error accepting friend request:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });
    router.post('/requests/reject/:requestId', isAuthenticated, async (req, res) => {
        try {
            const userId = req.session.userId;
            const { requestId } = req.params;
            const requestResult = await pool.query(
                'SELECT receiver_id FROM friend_requests WHERE id = $1 AND receiver_id = $2 AND status = \'pending\'',
                [requestId, userId]
            );
            if (requestResult.rows.length === 0) {
                return res.status(404).json({ error: 'Friend request not found or not pending.' });
            }
            await pool.query(
                'UPDATE friend_requests SET status = \'rejected\' WHERE id = $1',
                [requestId]
            );
            res.status(200).json({ message: 'Friend request rejected.' });
        } catch (error) {
            console.error('Error rejecting friend request:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });
    router.post('/requests/cancel/:requestId', isAuthenticated, async (req, res) => {
        try {
            const userId = req.session.userId;
            const { requestId } = req.params;
            const requestResult = await pool.query(
                'SELECT sender_id FROM friend_requests WHERE id = $1 AND sender_id = $2 AND status = \'pending\'',
                [requestId, userId]
            );
            if (requestResult.rows.length === 0) {
                return res.status(404).json({ error: 'Friend request not found or not pending.' });
            }
            await pool.query(
                'UPDATE friend_requests SET status = \'canceled\' WHERE id = $1',
                [requestId]
            );
            res.status(200).json({ message: 'Friend request canceled.' });
        } catch (error) {
            console.error('Error canceling friend request:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });
    return router;
};