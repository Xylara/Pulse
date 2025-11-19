DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    profile_picture VARCHAR(255) DEFAULT '/others/default_avatar.png' NOT NULL,
    isadmin VARCHAR(3) DEFAULT 'no' NOT NULL,
    is_verified VARCHAR(3) DEFAULT 'no' NOT NULL,
    verification_token VARCHAR(255)
);
DROP TABLE IF EXISTS announcements;

CREATE TABLE announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);