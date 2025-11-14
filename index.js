require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const express = require('express');
const createAuthRouter = require('./modules/auth');
const { startCli } = require('./modules/cli');

const app = express();
const port = 3000;
const saltRounds = 10;

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: {
        rejectUnauthorized: false,
    },
});

pool.connect()
    .then(() => console.log('Database connected'))
    .catch(err => console.error('error', err.stack));

app.set('view engine', 'ejs');

app.use(express.urlencoded({ extended: true }));

app.use('/', createAuthRouter(pool, bcrypt, saltRounds));

app.get('/dashboard', (req, res) => {
    res.send('damn');
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    startCli(pool);
});