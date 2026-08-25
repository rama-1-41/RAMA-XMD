// multi-user.js
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const sessionManager = require('./lib/sessionManager');
const P = require('pino');
const fs = require('fs');
const path = require('path');

const userConnections = new Map();

// Load user's plugins
function loadUserPlugins(userId) {
    const pluginPath = path.join(__dirname, 'user-plugins', userId);
    const plugins = {};
    
    if (fs.existsSync(pluginPath)) {
        const files = fs.readdirSync(pluginPath).filter(f => f.endsWith('.js'));
        for (const file of files) {
            try {
                const plugin = require(path.join(pluginPath, file));
                plugins[file.replace('.js', '')] = plugin;
            } catch (err) {
                console.error(`Error loading plugin ${file} for user ${userId}:`, err.message);
            }
        }
    }
    
    // Also load global plugins
    const globalPluginPath = path.join(__dirname, 'plugins');
    if (fs.existsSync(globalPluginPath)) {
        const files = fs.readdirSync(globalPluginPath).filter(f => f.endsWith('.js') && f !== 'index.js');
        for (const file of files) {
            try {
                const plugin = require(path.join(globalPluginPath, file));
                plugins[file.replace('.js', '')] = plugin;
            } catch (err) {
                console.error(`Error loading global plugin ${file}:`, err.message);
            }
        }
    }
    
    return plugins;
}

async function startUserBot(userId) {
    console.log(`🚀 Starting bot for user: ${userId}`);
    if (userConnections.has(userId)) {
        console.log(`⚠️ User ${userId} already running`);
        return userConnections.get(userId);
    }

    try {
        const session = sessionManager.getSession(userId);
        const config = session.config;

        const { state, saveCreds } = await useMultiFileAuthState(
            session.sessionFile.replace('.json', '')
        );

        const conn = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            browser: ['RAMA-XMD', 'Chrome', '120.0.0.0'],
            logger: P({ level: 'silent' }),
        });

        userConnections.set(userId, conn);
        conn.ev.on('creds.update', saveCreds);

        const plugins = loadUserPlugins(userId);
        console.log(`✅ Loaded ${Object.keys(plugins).length} plugins for ${userId}`);

        conn.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message) return;

            for (const [name, plugin] of Object.entries(plugins)) {
                try {
                    if (plugin.handler && typeof plugin.handler === 'function') {
                        await plugin.handler(conn, msg, config);
                    }
                } catch (err) {
                    console.error(`Error in plugin ${name} for ${userId}:`, err.message);
                }
            }
        });

        console.log(`✅ User ${userId} bot started`);
        return conn;
    } catch (err) {
        console.error(`❌ Failed to start ${userId}:`, err.message);
        return null;
    }
}

async function startAllUsers() {
    const users = sessionManager.getAllUsers();
    
    if (users.length === 0) {
        console.log('📝 No users found. Creating default user...');
        sessionManager.getSession('default');
        await startUserBot('default');
    } else {
        for (const userId of users) {
            await startUserBot(userId);
        }
    }
    
    console.log(`✅ Running ${userConnections.size} bot(s)`);
}

async function addUser(userId) {
    if (userConnections.has(userId)) {
        console.log(`⚠️ User ${userId} already exists`);
        return;
    }
    sessionManager.getSession(userId);
    await startUserBot(userId);
    console.log(`✅ Added user: ${userId}`);
}

// ─── CLI ──────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case 'start':
            await startAllUsers();
            break;
        case 'add':
            if (!args[1]) {
                console.log('❌ Usage: node multi-user.js add <userId>');
                return;
            }
            await addUser(args[1]);
            break;
        case 'list':
            console.log('👥 Users:', sessionManager.getAllUsers());
            console.log('🟢 Active:', Array.from(userConnections.keys()));
            break;
        default:
            console.log(`
📋 RAMA-XMD Multi-User Commands:
  node multi-user.js start     - Start all users
  node multi-user.js add <id>  - Add a new user
  node multi-user.js list      - List all users
            `);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { startUserBot, startAllUsers, addUser, userConnections };