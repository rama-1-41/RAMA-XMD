
require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')
const { MongoClient } = require('mongodb');
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./unkown');
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay,
    Browsers
} = require("@whiskeysockets/baileys")
const NodeCache = require("node-cache")
const pino = require("pino")
const readline = require("readline")
const { parsePhoneNumber } = require("libphonenumber-js")
const { PHONENUMBER_MCC } = require('@whiskeysockets/baileys/lib/Utils/generics')
const { rmSync, existsSync } = require('fs')
const { join } = require('path')
const P = require("pino");

// ============ EXPRESS & SOCKET.IO SETUP ============
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

const port = process.env.PORT || 3000;

// ============ IMPORTS ============
const store = require('./lib/lightweight_store');
const settings = require('./settings');

// ============ SESSION CACHE (Local-first) ============
const sessionCache = {
    sessions: new Map(),

    async get(sessionId) {
        if (this.sessions.has(sessionId)) {
            return this.sessions.get(sessionId);
        }

        const sessionPath = path.join(SESSION_DIR, sessionId);
        const credsPath = path.join(sessionPath, 'creds.json');
        if (fs.existsSync(credsPath)) {
            try {
                const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                const keysPath = path.join(sessionPath, 'keys.json');
                const keys = fs.existsSync(keysPath) ? JSON.parse(fs.readFileSync(keysPath, 'utf8')) : null;
                const sessionData = { creds, keys, isValid: true, isActive: true };
                this.sessions.set(sessionId, sessionData);
                return sessionData;
            } catch (e) {
                return await this.loadFromMongo(sessionId);
            }
        }

        return await this.loadFromMongo(sessionId);
    },

    async loadFromMongo(sessionId) {
        if (!sessionsCol) return null;
        const sanitized = sessionId.replace(/[^0-9]/g, '');
        try {
            const doc = await sessionsCol.findOne({ number: sanitized });
            if (doc && doc.creds) {
                const sessionPath = path.join(SESSION_DIR, sessionId);
                ensureDirSync(sessionPath);
                fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(doc.creds, null, 2));
                if (doc.keys) {
                    fs.writeFileSync(path.join(sessionPath, 'keys.json'), JSON.stringify(doc.keys, null, 2));
                }
                const sessionData = { creds: doc.creds, keys: doc.keys || null, isValid: doc.isValid !== false, isActive: doc.isActive !== false };
                this.sessions.set(sessionId, sessionData);
                return sessionData;
            }
            return null;
        } catch (e) {
            return null;
        }
    },

    saveToLocal(sessionId, creds, keys = null) {
        const sessionPath = path.join(SESSION_DIR, sessionId);
        ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(creds, null, 2));
        if (keys) {
            fs.writeFileSync(path.join(sessionPath, 'keys.json'), JSON.stringify(keys, null, 2));
        }
        this.sessions.set(sessionId, { creds, keys, isValid: true, isActive: true });
        return true;
    },

    queueBackup(sessionId, creds, keys = null) {
        queueSessionSave(sessionId, creds, keys, true, true);
    }
};

// ============ UTILITY ============
function ensureDirSync(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// ============ MONGODB SETUP ============
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb+srv://presenter:ryan.3063@cluster0.94sivgt.mongodb.net/?appName=Cluster0";
const MONGO_DB = process.env.MONGO_DB || "whatsapp_sessions";

let mongoClient;
let sessionsCol;
let statsCol;
let invalidSessionsCol;

const MONGO_OPTIONS = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 30000,
    connectTimeoutMS: 15000,
    maxPoolSize: 5,
    minPoolSize: 2,
    maxIdleTimeMS: 30000,
    heartbeatFrequencyMS: 10000,
    compressors: ['snappy']
};

async function initMongo(retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            if (mongoClient?.topology?.isConnected) return true;
            mongoClient = new MongoClient(MONGO_URI, MONGO_OPTIONS);
            await mongoClient.connect();
            const db = mongoClient.db(MONGO_DB);
            sessionsCol = db.collection('sessions');
            statsCol = db.collection('bot_stats');
            invalidSessionsCol = db.collection('invalid_sessions');
            await db.command({ ping: 1 });
            
            Promise.all([
                sessionsCol.createIndex({ number: 1 }, { unique: true, background: true }),
                sessionsCol.createIndex({ updatedAt: -1 }, { background: true }),
                sessionsCol.createIndex({ isValid: 1 }, { background: true }),
                sessionsCol.createIndex({ isActive: 1 }, { background: true }),
                invalidSessionsCol.createIndex({ number: 1 }, { unique: true, background: true }),
                invalidSessionsCol.createIndex({ loggedOutAt: -1 }, { background: true }),
                statsCol.createIndex({ timestamp: -1 }, { background: true })
            ]).catch(() => {});
            
            console.log(chalk.green(`✅ MongoDB (${MONGO_DB}) connected`));
            return true;
        } catch (error) {
            console.log(chalk.yellow(`⚠️ MongoDB attempt ${i+1}/${retries} failed: ${error.message}`));
            if (i === retries - 1) return false;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    return false;
}

// ============ BATCH SAVES ============
let pendingSaves = [];
let saveTimeout = null;

async function batchSaveToMongo() {
    if (pendingSaves.length === 0) return;
    const batch = pendingSaves.slice();
    pendingSaves = [];
    try {
        const operations = batch.map(({ number, creds, keys, isValid, isActive }) => ({
            updateOne: {
                filter: { number: number.replace(/[^0-9]/g, '') },
                update: {
                    $set: {
                        creds, keys, isValid, isActive,
                        updatedAt: new Date(),
                        lastBackup: new Date()
                    }
                },
                upsert: true
            }
        }));
        if (sessionsCol && operations.length > 0) {
            await sessionsCol.bulkWrite(operations, { ordered: false });
        }
    } catch (e) {
        for (const item of batch) {
            await saveSessionToMongo(item.number, item.creds, item.keys, item.isValid, item.isActive);
        }
    }
}

function queueSessionSave(number, creds, keys = null, isValid = true, isActive = true) {
    pendingSaves.push({ number, creds, keys, isValid, isActive });
    if (!saveTimeout) {
        saveTimeout = setTimeout(() => {
            saveTimeout = null;
            batchSaveToMongo();
        }, 1000);
    }
}

// ============ SESSION FUNCTIONS ============

async function saveSessionToMongo(number, creds, keys = null, isValid = true, isActive = true) {
    sessionCache.saveToLocal(number, creds, keys);
    sessionCache.queueBackup(number, creds, keys);
    return true;
}

async function updateSessionActiveStatus(number, isActive) {
    const sessionData = await sessionCache.get(number);
    if (sessionData) {
        sessionData.isActive = isActive;
        sessionCache.sessions.set(number, sessionData);
        const sanitized = number.replace(/[^0-9]/g, '');
        if (sessionsCol) {
            await sessionsCol.updateOne(
                { number: sanitized },
                { $set: { isActive, updatedAt: new Date() } }
            );
        }
    }
    return true;
}

async function markSessionAsInvalid(number, reason = 'logged_out') {
    const sanitized = number.replace(/[^0-9]/g, '');
    const sessionData = await sessionCache.get(number);
    if (sessionData) {
        sessionData.isValid = false;
        sessionData.isActive = false;
        sessionCache.sessions.set(number, sessionData);
    }
    if (sessionsCol) {
        await Promise.all([
            sessionsCol.updateOne(
                { number: sanitized },
                { $set: { isValid: false, isActive: false, invalidatedAt: new Date(), invalidReason: reason } }
            ),
            invalidSessionsCol.updateOne(
                { number: sanitized },
                { $set: { number: sanitized, loggedOutAt: new Date(), reason, lastSeen: new Date() } },
                { upsert: true }
            )
        ]);
    }
    return true;
}

async function deleteSessionCompletely(sessionId, sessionPath) {
    const sanitized = sessionId.replace(/[^0-9]/g, '');
    sessionCache.sessions.delete(sessionId);
    if (sessionsCol) {
        await Promise.all([
            sessionsCol.deleteOne({ number: sanitized }),
            invalidSessionsCol.deleteOne({ number: sanitized })
        ]);
    }
    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
    }
    return true;
}

// ============ CONFIGURATION ============
const BOT_NAME = process.env.BOT_NAME || "RAMA-XMD";
const OWNER_NUMBER = process.env.OWNER_NUMBER || "254769769295";
const PREFIX = process.env.PREFIX || ".";
const MAX_USERS = parseInt(process.env.MAX_USERS) || 50;

// ============ ACTIVE SESSIONS TRACKING ============
let activeSessions = 0;
let totalUsers = 0;
const pendingQueue = [];
const activeConnections = new Map();
const reconnectAttempts = new Map();
const MAX_RECONNECT_ATTEMPTS = 10;

// ============ PATHS ============
const SESSION_DIR = path.join(__dirname, "sessions");
const DATA_DIR = path.join(__dirname, "data");
const TEMP_MEDIA_DIR = path.join(__dirname, "temp");
const customTemp = path.join(process.cwd(), 'temp');

[SESSION_DIR, DATA_DIR, TEMP_MEDIA_DIR, customTemp].forEach(ensureDirSync);

process.env.TMPDIR = customTemp;
process.env.TEMP = customTemp;
process.env.TMP = customTemp;

// ============ STORE INIT ============
let storeInitialized = false;
function initStore() {
    if (storeInitialized) return;
    if (typeof store.readFromFile === 'function') store.readFromFile();
    storeInitialized = true;
}
initStore();

// ============ SOCKET.IO STATUS BROADCAST ============
function broadcastStats() {
    io.emit('statsUpdate', {
        activeSockets: activeSessions,
        totalUsers: totalUsers
    });
}

// Broadcast stats every 5 seconds
setInterval(broadcastStats, 5000);

// ============ INTERVALS ============
setInterval(() => {
    if (typeof store.writeToFile === 'function') store.writeToFile();
}, settings.storeWriteInterval || 30000);

// Memory optimization
setInterval(() => {
    if (global.gc) {
        global.gc();
        console.log('🧹 Garbage collection completed');
    }
}, 60000);

// Memory monitoring
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024;
    if (used > 800) {
        console.log('⚠️ RAM too high (>800MB), restarting bot...');
        process.exit(1);
    }
}, 30000);

// Temp file cleanup
setInterval(() => {
    fs.readdir(customTemp, (err, files) => {
        if (err || files.length === 0) return;
        const now = Date.now();
        for (const file of files) {
            const filePath = path.join(customTemp, file);
            fs.stat(filePath, (err, stats) => {
                if (!err && now - stats.mtimeMs > 6 * 60 * 60 * 1000) {
                    fs.unlink(filePath, () => {});
                }
            });
        }
    });
}, 6 * 60 * 60 * 1000);

// ============ PERSISTENT DATA ============
const DATA_FILE = path.join(DATA_DIR, 'persistent-data.json');

function loadPersistentData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            totalUsers = data.totalUsers || 0;
            activeSessions = data.activeSessions || 0;
        }
    } catch (error) {
        totalUsers = 0;
        activeSessions = 0;
    }
}

function savePersistentData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({
            totalUsers,
            activeSessions,
            lastUpdated: new Date().toISOString()
        }, null, 2));
    } catch (error) {}
}

loadPersistentData();
setInterval(() => savePersistentData(), 60000);

// ============ SERVE STATIC FILES ============
// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ API ENDPOINTS ============
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get("/health", (req, res) => {
    res.json({
        status: "healthy",
        timestamp: Date.now(),
        activeSessions,
        totalUsers,
        maxUsers: MAX_USERS,
        capacity: Math.round((activeSessions / MAX_USERS) * 100)
    });
});

app.get("/api/status", (req, res) => {
    res.json({
        activeUsers: activeSessions,
        totalUsers: totalUsers,
        maxUsers: MAX_USERS,
        queueLength: pendingQueue.length,
        available: activeSessions < MAX_USERS,
        capacity: Math.round((activeSessions / MAX_USERS) * 100)
    });
});

// ============ PAIRING API ============
app.post("/api/pair", async (req, res) => {
    let conn;
    try {
        const { number } = req.body;
        if (!number) return res.status(400).json({ error: "Phone number is required" });

        const normalizedNumber = number.replace(/\D/g, "");

        if (!(activeSessions < MAX_USERS)) {
            if (!pendingQueue.includes(normalizedNumber)) pendingQueue.push(normalizedNumber);
            const queueIndex = pendingQueue.indexOf(normalizedNumber) + 1;
            return res.status(429).json({
                success: false,
                error: "SERVER AT MAXIMUM CAPACITY",
                message: `Maximum ${MAX_USERS} users reached. You are #${queueIndex} in queue.`,
                queuePosition: queueIndex,
                activeUsers: activeSessions
            });
        }

        const sessionPath = path.join(SESSION_DIR, normalizedNumber);

        // Load session from cache if exists
        const sessionData = await sessionCache.get(normalizedNumber);
        if (sessionData && sessionData.creds) {
            ensureDirSync(sessionPath);
            fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(sessionData.creds, null, 2));
            if (sessionData.keys) {
                fs.writeFileSync(path.join(sessionPath, 'keys.json'), JSON.stringify(sessionData.keys, null, 2));
            }
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        conn = makeWASocket({
            logger: P({ level: "silent" }),
            printQRInTerminal: false,
            auth: state,
            version,
            browser: Browsers.macOS("Edge"),
            connectTimeoutMs: 30000,
            keepAliveIntervalMs: 30000,
            maxIdleTimeMs: 60000,
            maxRetries: 3,
            markOnlineOnConnect: true,
            emitOwnEvents: true,
            defaultQueryTimeoutMs: 30000,
            syncFullHistory: false,
            transactionOpts: {
                maxCommitRetries: 3,
                delayBetweenTriesMs: 3000
            },
            getMessage: async (key) => {
                let jid = jidNormalizedUser(key.remoteJid);
                let msg = await store.loadMessage(jid, key.id);
                return msg?.message || "";
            }
        });

        store.bind(conn.ev);

        conn.ev.on('creds.update', async () => {
            try {
                await saveCreds();
                const credsPath = path.join(sessionPath, 'creds.json');
                if (fs.existsSync(credsPath)) {
                    const credsObj = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                    const keysPath = path.join(sessionPath, 'keys.json');
                    const keysObj = fs.existsSync(keysPath) ? JSON.parse(fs.readFileSync(keysPath, 'utf8')) : null;
                    sessionCache.saveToLocal(normalizedNumber, credsObj, keysObj);
                    sessionCache.queueBackup(normalizedNumber, credsObj, keysObj);
                }
            } catch (err) {}
        });

        activeConnections.set(normalizedNumber, { conn, saveCreds, lastSeen: Date.now() });
        setupConnectionHandlers(conn, normalizedNumber, saveCreds, sessionPath);

        await new Promise(resolve => setTimeout(resolve, 2000));
        const pairingCode = await conn.requestPairingCode(normalizedNumber);

        // Emit pairing success via socket
        io.emit('linked', { sessionId: normalizedNumber });

        res.json({
            success: true,
            pairingCode,
            message: "Pairing code generated successfully",
            activeUsers: activeSessions,
            maxUsers: MAX_USERS
        });

    } catch (error) {
        if (conn) try { conn.ws.close(); } catch (e) {}
        res.status(500).json({
            error: "Failed to generate pairing code",
            details: error.message
        });
    }
});

// ============ CONNECTION HANDLERS ============
function setupConnectionHandlers(conn, sessionId, saveCreds, sessionPath) {
    let hasShownConnectedMessage = false;
    let hasConnected = false;
    let heartbeatInterval = null;

    conn.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {};
            return decode.user && decode.server && decode.user + '@' + decode.server || jid;
        }
        return jid;
    };

    // Anticall handler
    conn.ev.on('call', async (calls) => {
        try {
            if (!conn.user) return;
            const ownerId = conn.user.id.split(':')[0] + '@s.whatsapp.net';
            const anticallEnabled = settings.anticall || false;
            if (!anticallEnabled) return;

            for (const call of calls) {
                if (call.isGroup || call.status !== 'offer') continue;
                let callerJid = jidNormalizedUser(call.from || call.peerJid || call.chatId);
                if (!callerJid || callerJid === ownerId) continue;
                try { await conn.sendMessage(callerJid, { text: '📵 Anticall is enabled. Your call was rejected.' }); } catch (e) {}
                try { if (typeof conn.rejectCall === 'function' && call.id) await conn.rejectCall(call.id, callerJid); } catch (e) {}
                try { await conn.updateBlockStatus(callerJid, 'block'); } catch (e) {}
            }
        } catch (e) {}
    });

    conn.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
            reconnectAttempts.set(sessionId, 0);

            if (heartbeatInterval) clearInterval(heartbeatInterval);
            heartbeatInterval = setInterval(async () => {
                try {
                    if (conn?.user) {
                        await conn.sendPresenceUpdate('available');
                        const connData = activeConnections.get(sessionId);
                        if (connData) {
                            connData.lastSeen = Date.now();
                            activeConnections.set(sessionId, connData);
                        }
                    }
                } catch (error) {}
            }, 60000);

            if (!hasConnected) {
                hasConnected = true;
                activeSessions++;
                totalUsers++;
                savePersistentData();
                broadcastStats();
                updateSessionActiveStatus(sessionId, true);
                saveFullSessionToMongo(sessionId, sessionPath);
            }

            if (!hasShownConnectedMessage) {
                hasShownConnectedMessage = true;
                setTimeout(async () => {
                    try {
                        // Auto-follow channels
                        const channels = [
                            '120363428121144787@newsletter',
                            '120363428121144787@newsletter'
                        ];
                        for (const channel of channels) {
                            try { await conn.newsletterFollow(channel); } catch (e) {}
                            await new Promise(r => setTimeout(r, 500));
                        }

                        const userJid = `${conn.user.id.split(":")[0]}@s.whatsapp.net`;
                        try {
                            await conn.sendMessage(userJid, {
                                text: `🤖 *${BOT_NAME} Connected!*\n\n📌 *Prefix:* ${PREFIX}\n✅ *Status:* Online and Ready!\n\n📢 *Auto-followed:* Channels\n❤️ *Auto-like:* Enabled`
                            });
                        } catch (err) {
                            await conn.sendMessage(userJid, { text: `🎉 ${BOT_NAME} Connected!\n📌 Prefix: ${PREFIX}` });
                        }
                    } catch (error) {}
                }, 2000);
            }
        }

        if (connection === "close") {
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
                heartbeatInterval = null;
            }
            if (hasConnected) {
                hasConnected = false;
                activeSessions = Math.max(0, activeSessions - 1);
                savePersistentData();
                broadcastStats();
                updateSessionActiveStatus(sessionId, false);
            }

            const isLoggedOut = lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;
            if (isLoggedOut) {
                console.log(chalk.red(`🔄 Session ${sessionId} logged out, deleting...`));
                await deleteSessionCompletely(sessionId, sessionPath);
                activeConnections.delete(sessionId);
                savePersistentData();
                broadcastStats();
                return;
            }

            const currentAttempts = reconnectAttempts.get(sessionId) || 0;
            if (currentAttempts < MAX_RECONNECT_ATTEMPTS && activeConnections.has(sessionId)) {
                reconnectAttempts.set(sessionId, currentAttempts + 1);
                const delayTime = Math.min(2000 * Math.pow(1.3, currentAttempts), 30000);
                console.log(chalk.yellow(`🔄 Reconnecting ${sessionId} (attempt ${currentAttempts + 1}/${MAX_RECONNECT_ATTEMPTS}) in ${delayTime/1000}s...`));
                setTimeout(() => {
                    if (activeConnections.has(sessionId)) {
                        initializeConnection(sessionId);
                    }
                }, delayTime);
            } else if (currentAttempts >= MAX_RECONNECT_ATTEMPTS) {
                console.log(chalk.red(`❌ Max reconnection attempts reached for ${sessionId}`));
                activeConnections.delete(sessionId);
                broadcastStats();
            }
        }
    });

    conn.ev.on("creds.update", async () => {
        if (saveCreds) {
            await saveCreds();
            const credsPath = path.join(sessionPath, 'creds.json');
            if (fs.existsSync(credsPath)) {
                const credsObj = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                const keysPath = path.join(sessionPath, 'keys.json');
                const keysObj = fs.existsSync(keysPath) ? JSON.parse(fs.readFileSync(keysPath, 'utf8')) : null;
                sessionCache.saveToLocal(sessionId, credsObj, keysObj);
                sessionCache.queueBackup(sessionId, credsObj, keysObj);
            }
        }
    });

    // Messages processing
    conn.ev.on("messages.upsert", async (m) => {
        setImmediate(async () => {
            try {
                const message = m.messages[0];
                if (!message.message) return;

                if (Object.keys(message.message)[0] === 'ephemeralMessage') {
                    message.message = message.message.ephemeralMessage.message;
                }

                // STATUS BROADCAST
                if (message.key?.remoteJid === 'status@broadcast') {
                    if (message.key.fromMe) return;
                    try {
                        const ownerId = conn.user.id.split(':')[0] + '@s.whatsapp.net';
                        const fromJid = message.key.participant || message.key.remoteJid;

                        if (settings.autoviewStatus !== false) {
                            const participantToUse = message.key.participantPn || message.key.participant;
                            await conn.readMessages([{
                                remoteJid: message.key.remoteJid,
                                id: message.key.id,
                                fromMe: message.key.fromMe,
                                participant: participantToUse
                            }]);
                        }

                        if (settings.autoLikeStatus !== false && message.key.participant) {
                            const participantToUse = message.key.participantPn || message.key.participant;
                            const emojis = (settings.statusLikeEmojis || '❤️,🔥,🥳,👏,💪,✨,⭐,🌟,💫,🎉,😍,🤩,😎,💖,🧡,💛,💚,💙,💜').split(',').map(e => e.trim());
                            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)] || '❤️';
                            await conn.sendMessage(
                                message.key.remoteJid,
                                { react: { key: { remoteJid: message.key.remoteJid, id: message.key.id, fromMe: message.key.fromMe, participant: participantToUse }, text: randomEmoji } },
                                { statusJidList: [participantToUse] }
                            );
                        }

                        if (settings.autoReplyStatus && !message.key.fromMe && settings.statusReplyText) {
                            await conn.sendMessage(fromJid, { text: settings.statusReplyText }, { quoted: message });
                        }
                    } catch (error) {
                        console.error('Status handler error:', error);
                    }
                    return;
                }

                // CHANNEL AUTO-REACT
                const isChannel = message.key.remoteJid?.endsWith('@newsletter');
                if (isChannel) {
                    const channelJid = message.key.remoteJid;
                    const serverId = message.key.server_id || message.newsletterServerId;
                    const mtype = Object.keys(message.message)[0];
                    if (mtype === 'reactionMessage' || mtype === 'protocolMessage') return;
                    
                    const AUTO_REACT_CHANNELS = ['120363428121144787@newsletter', '120363428121144787@newsletter'];
                    if (AUTO_REACT_CHANNELS.includes(channelJid) && serverId && Math.random() <= 0.9) {
                        const emojis = ['❤️', '🔥', '🥳', '👏', '💪', '✨', '⭐', '🌟', '💫', '🎉', '😍', '🤩', '😎', '💖', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '🌹', '🌸', '💎', '👑', '🏆', '🎯'];
                        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
                        setTimeout(async () => {
                            try {
                                await conn.newsletterReactMessage(channelJid, serverId.toString(), emoji);
                            } catch (err) {}
                        }, 1000 + Math.random() * 2000);
                    }
                    return;
                }

                if (message.key.id.startsWith('BAE5') && message.key.id.length === 16) return;
                if (conn?.msgRetryCounterCache) conn.msgRetryCounterCache.clear();

                await handleMessages(conn, m, true);
            } catch (error) {
                console.error('Messages.upsert error:', error);
            }
        });
    });

    conn.ev.on('group-participants.update', async (update) => {
        await handleGroupParticipantUpdate(conn, update);
    });
}

async function saveFullSessionToMongo(sessionId, sessionPath) {
    try {
        const credsPath = path.join(sessionPath, 'creds.json');
        if (fs.existsSync(credsPath)) {
            const credsObj = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
            const keysPath = path.join(sessionPath, 'keys.json');
            const keysObj = fs.existsSync(keysPath) ? JSON.parse(fs.readFileSync(keysPath, 'utf8')) : null;
            sessionCache.saveToLocal(sessionId, credsObj, keysObj);
            sessionCache.queueBackup(sessionId, credsObj, keysObj);
        }
    } catch (error) {}
}

// ============ REINITIALIZE CONNECTION ============
async function initializeConnection(sessionId) {
    try {
        const sessionPath = path.join(SESSION_DIR, sessionId);

        let needsRestore = false;
        if (!fs.existsSync(sessionPath) || !fs.existsSync(path.join(sessionPath, 'creds.json'))) {
            needsRestore = true;
        }

        if (needsRestore) {
            const mongoSession = await sessionCache.loadFromMongo(sessionId);
            if (!mongoSession) {
                return;
            }
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        const conn = makeWASocket({
            logger: P({ level: "silent" }),
            printQRInTerminal: false,
            auth: state,
            version,
            browser: Browsers.macOS("Edge"),
            connectTimeoutMs: 30000,
            keepAliveIntervalMs: 30000,
            maxIdleTimeMs: 60000,
            maxRetries: 3,
            markOnlineOnConnect: true,
            emitOwnEvents: true,
            defaultQueryTimeoutMs: 30000,
            syncFullHistory: false,
            getMessage: async (key) => {
                let jid = jidNormalizedUser(key.remoteJid);
                let msg = await store.loadMessage(jid, key.id);
                return msg?.message || "";
            }
        });

        store.bind(conn.ev);

        if (!activeConnections.has(sessionId)) {
            activeConnections.set(sessionId, { conn, saveCreds, lastSeen: Date.now() });
        } else {
            activeConnections.set(sessionId, { conn, saveCreds, lastSeen: Date.now() });
        }

        setupConnectionHandlers(conn, sessionId, saveCreds, sessionPath);

        conn.ev.on('creds.update', async () => {
            await saveFullSessionToMongo(sessionId, sessionPath);
        });

    } catch (error) {
        console.error(`Error initializing connection for ${sessionId}:`, error);
    }
}

// ============ RELOAD EXISTING SESSIONS ============
async function reloadExistingSessions() {
    const mongoConnected = await initMongo();

    if (!mongoConnected || !sessionsCol) {
        console.log(chalk.red(`❌ MongoDB not connected, cannot restore sessions`));
        return;
    }

    let restoredCount = 0;
    const restoredSessions = new Set();

    // Load from local files
    if (fs.existsSync(SESSION_DIR)) {
        const fileSessions = fs.readdirSync(SESSION_DIR).filter(file => {
            const sessionPath = path.join(SESSION_DIR, file);
            const isDir = fs.statSync(sessionPath).isDirectory();
            const hasCreds = fs.existsSync(path.join(sessionPath, 'creds.json'));
            return isDir && hasCreds;
        });

        for (const sessionId of fileSessions) {
            if (activeSessions >= MAX_USERS) break;
            if (activeConnections.has(sessionId)) continue;
            await initializeConnection(sessionId);
            restoredCount++;
            restoredSessions.add(sessionId);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // Load from MongoDB
    if (sessionsCol) {
        try {
            const mongoSessions = await sessionsCol.find({ isValid: { $ne: false } }).toArray();
            for (const session of mongoSessions) {
                const sessionId = session.number;
                if (activeSessions >= MAX_USERS) break;
                if (restoredSessions.has(sessionId) || activeConnections.has(sessionId)) continue;

                const sessionPath = path.join(SESSION_DIR, sessionId);
                if (!fs.existsSync(path.join(sessionPath, 'creds.json'))) {
                    await sessionCache.loadFromMongo(sessionId);
                }
                await initializeConnection(sessionId);
                restoredCount++;
                restoredSessions.add(sessionId);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } catch (error) {
            console.log(chalk.red(`❌ Error restoring sessions from MongoDB: ${error.message}`));
        }
    }

    console.log(chalk.green(`✅ Restored ${restoredCount} sessions`));
    broadcastStats();
}

// ============ START SERVER ============
server.listen(port, async () => {
    console.log(chalk.cyan(`
╔═══════════════════════════════════════╗
║   🤖 ${BOT_NAME} - MULTI-USER        ║
║   Port: ${port}                         ║
║   Users: ${MAX_USERS}                      ║
║   MongoDB: ${MONGO_DB}                    ║
║   Version: ${settings.version || '1.0.0'}        ║
╚═══════════════════════════════════════╝
    `));
    await reloadExistingSessions();
});

// ============ GRACEFUL SHUTDOWN ============
let isShuttingDown = false;

async function gracefulShutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log("\n🛑 Shutting down...");
    savePersistentData();

    if (saveTimeout) {
        clearTimeout(saveTimeout);
        await batchSaveToMongo();
    }

    for (const [sessionId, data] of activeConnections) {
        try {
            const sessionPath = path.join(SESSION_DIR, sessionId);
            await saveFullSessionToMongo(sessionId, sessionPath);
        } catch (err) {}
        try {
            if (data.conn && typeof data.conn.ws.close === 'function') {
                data.conn.ws.close();
            }
        } catch (error) {}
    }

    if (mongoClient) await mongoClient.close();

    server.close(async () => {
        process.exit(0);
    });
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
process.on("uncaughtException", (error) => {
    console.error('Uncaught Exception:', error);
});
process.on("unhandledRejection", (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});

module.exports = { store, activeConnections, activeSessions, totalUsers, io };