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
    const uniqueUsers = [];
    const seenUserIds = new Set();

    for (const user of users) {
      if (!seenUserIds.has(user.id)) {
        uniqueUsers.push(user);
        seenUserIds.add(user.id);
      }
    }
    return uniqueUsers;
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

const updateUserField = async (userId, fieldName, fieldValue) => {
  try {
    let users = await readUsers();
    
    const userIndex = users.findIndex(u => u.id === userId);

    if (userIndex !== -1) {
      users[userIndex][fieldName] = fieldValue;
      
      await writeUsers(users);
      console.log(`User ${userId}'s ${fieldName} updated locally and written to CDN.`);
    } else {
      console.warn(`User ${userId} not found for update.`);
    }
  } catch (error) {
    console.error(`Error updating user ${userId}'s ${fieldName}:`, error.message);
    throw error;
  }
};

const CDN_GROUPCHATS_FILENAME = 'groupchats.json';

const readGroupChats = async () => {
  try {
    const response = await axios.get(`${CDN_BASE_URL}/cdn/${CDN_USERS_FOLDER}/${CDN_GROUPCHATS_FILENAME}`, {
      headers: {
        'Authorization': CDN_AUTH_TOKEN
      }
    });
    return response.data || [];
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log("Group chat data file not found on CDN, returning empty array.");
      return [];
    }
    console.error("Error reading group chat data from CDN:", error.message);
    return [];
  }
};

const writeGroupChats = async (groupChats) => {
  try {
    await axios.post(`${CDN_BASE_URL}/update-json`, {
      folder: CDN_USERS_FOLDER,
      filename: CDN_GROUPCHATS_FILENAME,
      data: groupChats
    }, {
      headers: {
        'Authorization': CDN_AUTH_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    console.log('Group chat data updated on CDN.');
  } catch (error) {
    console.error("Error writing group chat data to CDN:", error.message);
    throw error;
  }
};

module.exports = { readUsers, writeUsers, updateUserField, readGroupChats, writeGroupChats };