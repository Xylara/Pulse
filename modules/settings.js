const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

function createSettingsRouter(pool, isAuthenticated, bcrypt, saltRounds, nimbusUrl, nimbusApi) {
    const router = express.Router();

    router.get('/', isAuthenticated, (req, res) => {
        res.render('settings', { request: req, successMessage: null, errorMessage: null });
    });

    router.post('/change-username', isAuthenticated, async (req, res) => {
        const { newUsername } = req.body;
        const userId = req.session.user.id;

        if (!newUsername) {
            return res.render('settings', { request: req, errorMessage: 'New username cannot be empty.', successMessage: null });
        }

        const disallowedCharsPattern = /[<>"'&]/;
        if (disallowedCharsPattern.test(newUsername)) {
            return res.render('settings', { request: req, errorMessage: 'Username cannot contain <, >, ", \', or & characters.', successMessage: null });
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

    router.post('/change-password', isAuthenticated, async (req, res) => {
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

    const uploadDir = 'uploads/'; 

    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir);
            }
            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            cb(null, req.session.user.id + path.extname(file.originalname));
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

    router.post('/change-profile-picture', isAuthenticated, (req, res) => {
        upload(req, res, async (err) => {
            if (err) {
                console.error('Error uploading file locally:', err);
                return res.render('settings', { request: req, errorMessage: err, successMessage: null });
            }
            if (!req.file) {
                return res.render('settings', { request: req, errorMessage: 'No file selected.', successMessage: null });
            }

            const userId = req.session.user.id;
            const filePath = req.file.path; 
            const filename = req.file.filename;

            const userResult = await pool.query('SELECT profile_picture FROM users WHERE id = $1', [userId]);
            const previousProfilePicture = userResult.rows[0]?.profile_picture;

            try {
                if (!nimbusUrl || !nimbusApi) {
                    fs.unlink(filePath, (unlinkErr) => { 
                        if (unlinkErr) console.error('Error deleting temp file:', unlinkErr);
                    });
                    return res.render('settings', { request: req, errorMessage: 'CDN configuration missing.', successMessage: null });
                }

                if (previousProfilePicture && previousProfilePicture.startsWith('/uploads/')) {
                    const oldPath = path.join(__dirname, previousProfilePicture);
                    if (fs.existsSync(oldPath)) {
                        fs.unlink(oldPath, (unlinkErr) => {
                            if (unlinkErr) {
                                console.error('Error deleting old local profile picture:', unlinkErr);
                            } else {
                                console.log('Old local profile picture deleted:', oldPath);
                            }
                        });
                    } else {
                        console.log('Old local profile picture not found, skipping deletion:', oldPath);
                    }
                }

                if (previousProfilePicture && previousProfilePicture.startsWith(nimbusUrl) && !previousProfilePicture.includes('default_avatar.png')) {
                    try {

                        const parts = previousProfilePicture.split('/');
                        const oldFilename = parts[parts.length - 1]; 
                        await axios.delete(`${nimbusUrl}/delete-file`, {
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': nimbusApi
                            },
                            data: {
                                folder: 'profile',
                                filename: oldFilename
                            }
                        });
                    } catch (cdnDeleteError) {
                        console.error('Error deleting old CDN profile picture:', cdnDeleteError.message);
                        if (cdnDeleteError.response) {
                            console.error('CDN Delete Error Response Status:', cdnDeleteError.response.status);
                            console.error('CDN Delete Error Response Data:', cdnDeleteError.response.data);
                        }
                    }
                }

                const uniqueFilename = `${userId}_${Date.now()}${path.extname(filename)}`;

                const formData = new FormData();
                formData.append('folder', 'profile');
                formData.append('file', fs.createReadStream(filePath), uniqueFilename); 
                formData.append('filename', uniqueFilename); 

                const cdnResponse = await axios.post(`${nimbusUrl}/upload`, formData, {
                    headers: {
                        ...formData.getHeaders(),
                        'Authorization': nimbusApi
                    }
                });

                fs.unlink(filePath, (unlinkErr) => { 
                    if (unlinkErr) console.error('Error deleting temp file:', unlinkErr);
                });

                if (cdnResponse.data && cdnResponse.data.fileUrl) {
                    const newProfilePicture = `${nimbusUrl}${cdnResponse.data.fileUrl}`;

                    await pool.query('UPDATE users SET profile_picture = $1 WHERE id = $2', [newProfilePicture, userId]);
                    req.session.user.profile_picture = newProfilePicture;

                    res.render('settings', { request: req, successMessage: 'Profile picture updated successfully!', errorMessage: null });
                } else {
                    console.error('CDN upload failed: No URL returned. CDN Response Status:', cdnResponse.status, 'CDN Response Data:', cdnResponse.data);
                    return res.render('settings', { request: req, errorMessage: 'CDN upload failed: No URL returned. Check server logs for details.', successMessage: null });
                }

            } catch (error) {
                console.error('Error updating profile picture with CDN:', error.message);
                if (error.response) {
                    console.error('CDN Error Response Status:', error.response.status);
                    console.error('CDN Error Response Data:', error.response.data);
                } else if (error.request) {
                    console.error('CDN Error: No response received from CDN service. Request:', error.request);
                } else {
                    console.error('CDN Error:', error.message);
                }

                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error deleting temp file on CDN upload failure:', unlinkErr);
                });
                res.render('settings', { request: req, errorMessage: 'Failed to update profile picture via CDN. Check server logs for details.', successMessage: null });
            }
        });
    });

    return router;
}

module.exports = createSettingsRouter;