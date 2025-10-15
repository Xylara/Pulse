const axios = require('axios');

const CDN_BASE_URL = process.env.CDN_BASE_URL;
const CDN_AUTH_TOKEN = process.env.CDN_AUTH_TOKEN;
const CDN_USERS_FOLDER = 'others';
const CDN_USERS_FILENAME = 'users.json';

const readUsers = async () => {
  try {
    const response = await axios.get(`${CDN_BASE_URL}/cdn/${CDN_USERS_FOLDER}/${CDN_USERS_FILENAME}`, {
      headers: {
        'Authorization': CDN_AUTH_TOKEN
      }
    });
    const users = response.data.flat();
    return users;
  } catch (error) {
    console.error("Error reading user data from CDN:", error.message);
    return [];
  }
};

const writeUsers = async (users) => {
  try {
    await axios.post(`${CDN_BASE_URL}/update-json`, {
      folder: CDN_USERS_FOLDER,
      filename: CDN_USERS_FILENAME,
      data: users
    }, {
      headers: {
        'Authorization': CDN_AUTH_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    console.log('Users data updated on CDN.');
  } catch (error) {
    console.error("Error writing user data to CDN:", error.message);
    throw error;
  }
};

module.exports = { readUsers, writeUsers };