const readline = require('readline');

async function setAdminStatus(pool, username, isAdminStatus) {
    const status = isAdminStatus ? 'yes' : 'no';
    const client = await pool.connect();
    try {
        const result = await client.query(
            'UPDATE users SET isadmin = $1 WHERE username = $2 RETURNING id, username, isadmin',
            [status, username]
        );
        if (result.rows.length === 0) {
            console.log(`User ${username} not found.`);
            return false;
        }
        const message = result.rows.isadmin === 'yes'
            ? `${username} is admin`
            : `${username} is no longer admin`;
        console.log(message);
        return true;
    } catch (err) {
        console.error('Error setting admin status:', err);
        return false;
    } finally {
        client.release();
    }
}

function startCli(pool) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '>'
    });

    rl.prompt();

    rl.on('line', async (line) => {
        const parts = line.trim().split(/\s+/);
        const [command, action, username] = parts;

        if (command === 'admin' && (action === 'add' || action === 'remove') && username) {
            const isAdmin = action === 'add';
            await setAdminStatus(pool, username, isAdmin);
        } else if (line.trim() !== '') {
            console.log('Invalid command. Usage: admin <add|remove> <username>');
        }
        rl.prompt();
    });
}

module.exports = { startCli, setAdminStatus };