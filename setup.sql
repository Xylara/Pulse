DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    isadmin VARCHAR(3) DEFAULT 'no' NOT NULL,
    is_verified VARCHAR(3) DEFAULT 'no' NOT NULL,
    verification_token VARCHAR(255)
);