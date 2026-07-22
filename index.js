const express = require("express");
const http = require("http");
require("dotenv").config();
const socketIo = require("socket.io");
const path = require("path");
const fs = require("fs");
const { useMultiFileAuthState, makeWASocket, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require("@whiskeysockets/baileys");
const P = require("pino");
const { MongoClient } = require('mongodb'); // <-- Added MongoDB client

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const port = process.env.PORT || 3000;

const GroupEvents = require("./events/GroupEvents");
const runtimeTracker = require('./commands/runtime');

// Import owner/sudo checker
const isOwnerOrSudo = require('./lib/isowner');

// ============ MongoDB Session Storage Setup ============
const SESSION_MONGO_URI = process.env.MONGO_URI || process.env.SESSION_MONGO_URI || "";
const SESSION_MONGO_DB = process.env.MONGO_DB || process.env.SESSION_MONGO_DB || "sessions";
let sessionMongoClient = null;
let sessionsCol = null;

// MongoDB connection options
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

async function initSessionMongo() {
    if (!SESSION_MONGO_URI) {
        console.log("⚠️ No MONGO_URI provided, session storage will be local only.");
        return false;
    }
    try {
        sessionMongoClient = new MongoClient(SESSION_MONGO_URI, MONGO_OPTIONS);
        await sessionMongoClient.connect();
        const db = sessionMongoClient.db(SESSION_MONGO_DB);
        sessionsCol = db.collection('sessions');
        await db.command({ ping: 1 });
        // Create indexes in background
        sessionsCol.createIndex({ number: 1 }, { unique: true, background: true });
        sessionsCol.createIndex({ updatedAt: -1 }, { background: true });
        console.log(`✅ Session DB (${SESSION_MONGO_DB}) connected`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to connect to session MongoDB: ${error.message}`);
        return false;
    }
}

// Save session to MongoDB
async function saveSessionToMongo(number, creds, keys = null) {
    if (!sessionsCol) return false;
    const sanitized = number.replace(/[^0-9]/g, '');
    try {
        await sessionsCol.updateOne(
            { number: sanitized },
            { 
                $set: { 
                    creds, 
                    keys, 
                    updatedAt: new Date(),
                    lastBackup: new Date()
                } 
            },
            { upsert: true }
        );
        return true;
    } catch (error) {
        console.error(`❌ Failed to save session ${number} to MongoDB:`, error.message);
        return false;
    }
}

// Load session from MongoDB
async function loadSessionFromMongo(number) {
    if (!sessionsCol) return null;
    const sanitized = number.replace(/[^0-9]/g, '');
    try {
        const doc = await sessionsCol.findOne({ number: sanitized });
        if (doc && doc.creds) {
            return { creds: doc.creds, keys: doc.keys || null };
        }
        return null;
    } catch (error) {
        console.error(`❌ Failed to load session ${number} from MongoDB:`, error.message);
        return null;
    }
}

// Delete session from MongoDB
async function deleteSessionFromMongo(number) {
    if (!sessionsCol) return false;
    const sanitized = number.replace(/[^0-9]/g, '');
    try {
        await sessionsCol.deleteOne({ number: sanitized });
        return true;
    } catch (error) {
        console.error(`❌ Failed to delete session ${number} from MongoDB:`, error.message);
        return false;
    }
}

// ========================================================

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Store active connections
const activeConnections = new Map();
const pairingCodes = new Map();
const userPrefixes = new Map();

// Store status media for forwarding
const statusMediaStore = new Map();

let activeSockets = 0;
let totalUsers = 0;

// Persistent data file path
const DATA_FILE = path.join(__dirname, 'persistent-data.json');

// Load persistent data
function loadPersistentData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            totalUsers = data.totalUsers || 0;
            console.log(`📊 Loaded persistent data: ${totalUsers} total users`);
        } else {
            console.log("📊 No existing persistent data found, starting fresh");
            savePersistentData(); // Create initial file
        }
    } catch (error) {
        console.error("❌ Error loading persistent data:", error);
        totalUsers = 0;
    }
}

// Save persistent data
function savePersistentData() {
    try {
        const data = {
            totalUsers: totalUsers,
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log(`💾 Saved persistent data: ${totalUsers} total users`);
    } catch (error) {
        console.error("❌ Error saving persistent data:", error);
    }
}

// Initialize persistent data
loadPersistentData();

// Auto-save persistent data every 30 seconds
setInterval(() => {
    savePersistentData();
}, 30000);

// Stats broadcasting helper
function broadcastStats() {
    io.emit("statsUpdate", { activeSockets, totalUsers });
}

// Track frontend connections (stats dashboard)
io.on("connection", (socket) => {
    console.log("📊 Frontend connected for stats");
    socket.emit("statsUpdate", { activeSockets, totalUsers });
    
    socket.on("disconnect", () => {
        console.log("📊 Frontend disconnected from stats");
    });
});

// Channel configuration
const CHANNEL_JIDS = process.env.CHANNEL_JIDS ? process.env.CHANNEL_JIDS.split(',') : [
    "120363401269012709@newsletter",
    "120363401269012709@newsletter",
    "120363401269012709@newsletter",
    "120363401269012709@newsletter",

];

// Default prefix for bot commands
let PREFIX = process.env.PREFIX || ".";

// Bot configuration from environment variables
const BOT_NAME = process.env.BOT_NAME || "RAMA-XMD";
const OWNER_NAME = process.env.OWNER_NAME || "404unkown";

const MENU_IMAGE_URL = process.env.MENU_IMAGE_URL || "https://files.catbox.moe/0dfeid.jpg";
const REPO_LINK = process.env.REPO_LINK || "https://github.com";

// Auto-status configuration
const AUTO_STATUS_SEEN = process.env.AUTO_STATUS_SEEN || "true";
const AUTO_STATUS_REACT = process.env.AUTO_STATUS_REACT || "false";
const AUTO_STATUS_REPLY = process.env.AUTO_STATUS_REPLY || "false";
const AUTO_STATUS_MSG = process.env.AUTO_STATUS_MSG || "YOUR STATUS HAS BEEN SEEN BY RAMA-XMD 💜";
const DEV = process.env.DEV || '404unkown';

// Track login state globally
let isUserLoggedIn = false;

// Load commands from commands folder
const commands = new Map();
const commandsPath = path.join(__dirname, 'commands');

// Modified loadCommands function to handle multi-command files
function loadCommands() {
    commands.clear();
    
    if (!fs.existsSync(commandsPath)) {
        console.log("❌ Commands directory not found:", commandsPath);
        fs.mkdirSync(commandsPath, { recursive: true });
        console.log("✅ Created commands directory");
        return;
    }

    const commandFiles = fs.readdirSync(commandsPath).filter(file => 
        file.endsWith('.js') && !file.startsWith('.')
    );

    console.log(`📂 Loading commands from ${commandFiles.length} files...`);

    for (const file of commandFiles) {
        try {
            const filePath = path.join(commandsPath, file);
            // Clear cache to ensure fresh load
            if (require.cache[require.resolve(filePath)]) {
                delete require.cache[require.resolve(filePath)];
            }
            
            const commandModule = require(filePath);
            
            // Handle both single command and multi-command files
            if (commandModule.pattern && commandModule.execute) {
                // Single command file
                commands.set(commandModule.pattern, commandModule);
                console.log(`✅ Loaded command: ${commandModule.pattern}`);
                
                // Add aliases
                if (commandModule.alias && Array.isArray(commandModule.alias)) {
                    commandModule.alias.forEach(alias => {
                        commands.set(alias, commandModule);
                        console.log(`✅ Loaded alias: ${alias} -> ${commandModule.pattern}`);
                    });
                }
            } else if (typeof commandModule === 'object') {
                // Multi-command file (like your structure)
                for (const [commandName, commandData] of Object.entries(commandModule)) {
                    if (commandData.pattern && commandData.execute) {
                        commands.set(commandData.pattern, commandData);
                        console.log(`✅ Loaded command: ${commandData.pattern}`);
                        
                        // Also add aliases if they exist
                        if (commandData.alias && Array.isArray(commandData.alias)) {
                            commandData.alias.forEach(alias => {
                                commands.set(alias, commandData);
                                console.log(`✅ Loaded alias: ${alias} -> ${commandData.pattern}`);
                            });
                        }
                    }
                }
            } else {
                console.log(`⚠️ Skipping ${file}: invalid command structure`);
            }
        } catch (error) {
            console.error(`❌ Error loading commands from ${file}:`, error.message);
        }
    }

    // Add runtime command
    const runtimeCommand = runtimeTracker.getRuntimeCommand();
    if (runtimeCommand.pattern && runtimeCommand.execute) {
        commands.set(runtimeCommand.pattern, runtimeCommand);
    }

    // Make commands globally accessible for other modules
    global.commands = commands;
    console.log(`✅ Total commands loaded: ${commands.size}`);
}

// Initial command load
loadCommands();

// Watch for changes in commands directory
if (fs.existsSync(commandsPath)) {
    fs.watch(commandsPath, (eventType, filename) => {
        if (filename && filename.endsWith('.js')) {
            console.log(`🔄 Reloading command: ${filename}`);
            loadCommands();
        }
    });
}

// Serve the main page
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// API endpoint to request pairing code
app.post("/api/pair", async (req, res) => {
    let conn;
    try {
        const { number } = req.body;
        
        if (!number) {
            return res.status(400).json({ error: "Phone number is required" });
        }

        // Normalize phone number
        const normalizedNumber = number.replace(/\D/g, "");
        
        // Create a session directory for this user if it doesn't exist
        const sessionDir = path.join(__dirname, "sessions", normalizedNumber);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Check if local creds exist; if not, try to load from MongoDB
        const credsPath = path.join(sessionDir, 'creds.json');
        if (!fs.existsSync(credsPath)) {
            const mongoSession = await loadSessionFromMongo(normalizedNumber);
            if (mongoSession && mongoSession.creds) {
                // Write to local files
                fs.writeFileSync(credsPath, JSON.stringify(mongoSession.creds, null, 2));
                if (mongoSession.keys) {
                    fs.writeFileSync(path.join(sessionDir, 'keys.json'), JSON.stringify(mongoSession.keys, null, 2));
                }
                console.log(`📥 Restored session ${normalizedNumber} from MongoDB to local`);
            }
        }

        // Initialize WhatsApp connection
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();
        
        conn = makeWASocket({
            logger: P({ level: "silent" }),
            printQRInTerminal: false,
            auth: state,
            version,
            browser: Browsers.macOS("Safari"),
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            maxIdleTimeMs: 60000,
            maxRetries: 10,
            markOnlineOnConnect: true,
            emitOwnEvents: true,
            defaultQueryTimeoutMs: 60000,
            syncFullHistory: false,
            transactionOpts: {
                maxCommitRetries: 10,
                delayBetweenTriesMs: 3000
            }
        });

        // Check if this is a new user (first time connection)
        const isNewUser = !activeConnections.has(normalizedNumber) && 
                         !fs.existsSync(path.join(sessionDir, 'creds.json'));

        // Store the connection and saveCreds function
        activeConnections.set(normalizedNumber, { 
            conn, 
            saveCreds, 
            hasLinked: activeConnections.get(normalizedNumber)?.hasLinked || false 
        });

        // Count this user in totalUsers only if it's a new user
        if (isNewUser) {
            totalUsers++;
            activeConnections.get(normalizedNumber).hasLinked = true;
            console.log(`👤 New user connected! Total users: ${totalUsers}`);
            savePersistentData(); // Save immediately for new users
        }
        
        broadcastStats();

        // Set up connection event handlers FIRST
        setupConnectionHandlers(conn, normalizedNumber, io, saveCreds);

        // Wait a moment for the connection to initialize
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Request pairing code
        const pairingCode = await conn.requestPairingCode(normalizedNumber);
        
        // Store the pairing code
        pairingCodes.set(normalizedNumber, { code: pairingCode, timestamp: Date.now() });

        // Return the pairing code to the frontend
        res.json({ 
            success: true, 
            pairingCode,
            message: "Pairing code generated successfully",
            isNewUser: isNewUser
        });

    } catch (error) {
        console.error("Error generating pairing code:", error);
        
        if (conn) {
            try {
                conn.ws.close();
            } catch (e) {}
        }
        
        res.status(500).json({ 
            error: "Failed to generate pairing code",
            details: error.message 
        });
    }
});

// Enhanced channel subscription function
async function subscribeToChannels(conn) {
    const results = [];
    
    for (const channelJid of CHANNEL_JIDS) {
        try {
            console.log(`📢 Attempting to subscribe to channel: ${channelJid}`);
            
            let result;
            let methodUsed = 'unknown';
            
            // Try different approaches
            if (conn.newsletterFollow) {
                methodUsed = 'newsletterFollow';
                result = await conn.newsletterFollow(channelJid);
            } 
            else if (conn.followNewsletter) {
                methodUsed = 'followNewsletter';
                result = await conn.followNewsletter(channelJid);
            }
            else if (conn.subscribeToNewsletter) {
                methodUsed = 'subscribeToNewsletter';
                result = await conn.subscribeToNewsletter(channelJid);
            }
            else if (conn.newsletter && conn.newsletter.follow) {
                methodUsed = 'newsletter.follow';
                result = await conn.newsletter.follow(channelJid);
            }
            else {
                methodUsed = 'manual_presence_only';
                await conn.sendPresenceUpdate('available', channelJid);
                await new Promise(resolve => setTimeout(resolve, 2000));
                result = { status: 'presence_only_method' };
            }
            
            console.log(`✅ Successfully subscribed to channel using ${methodUsed}!`);
            results.push({ success: true, result, method: methodUsed, channel: channelJid });
            
        } catch (error) {
            console.error(`❌ Failed to subscribe to channel ${channelJid}:`, error.message);
            
            try {
                console.log(`🔄 Trying silent fallback subscription method for ${channelJid}...`);
                await conn.sendPresenceUpdate('available', channelJid);
                await new Promise(resolve => setTimeout(resolve, 3000));
                console.log(`✅ Used silent fallback subscription method for ${channelJid}!`);
                results.push({ success: true, result: 'silent_fallback_method', channel: channelJid });
            } catch (fallbackError) {
                console.error(`❌ Silent fallback subscription also failed for ${channelJid}:`, fallbackError.message);
                results.push({ success: false, error: fallbackError, channel: channelJid });
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return results;
}

// Function to get message type
function getMessageType(message) {
    if (message.message?.conversation) return 'TEXT';
    if (message.message?.extendedTextMessage) return 'TEXT';
    if (message.message?.imageMessage) return 'IMAGE';
    if (message.message?.videoMessage) return 'VIDEO';
    if (message.message?.audioMessage) return 'AUDIO';
    if (message.message?.documentMessage) return 'DOCUMENT';
    if (message.message?.stickerMessage) return 'STICKER';
    if (message.message?.contactMessage) return 'CONTACT';
    if (message.message?.locationMessage) return 'LOCATION';
    
    const messageKeys = Object.keys(message.message || {});
    for (const key of messageKeys) {
        if (key.endsWith('Message')) {
            return key.replace('Message', '').toUpperCase();
        }
    }
    
    return 'UNKNOWN';
}

// Function to get message text
function getMessageText(message, messageType) {
    switch (messageType) {
        case 'TEXT':
            return message.message?.conversation || 
                   message.message?.extendedTextMessage?.text || '';
        case 'IMAGE':
            return message.message?.imageMessage?.caption || '[Image]';
        case 'VIDEO':
            return message.message?.videoMessage?.caption || '[Video]';
        case 'AUDIO':
            return '[Audio]';
        case 'DOCUMENT':
            return message.message?.documentMessage?.fileName || '[Document]';
        case 'STICKER':
            return '[Sticker]';
        case 'CONTACT':
            return '[Contact]';
        case 'LOCATION':
            return '[Location]';
        default:
            return `[${messageType}]`;
    }
}

// Function to get quoted message details
function getQuotedMessage(message) {
    if (!message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        return null;
    }
    
    const quoted = message.message.extendedTextMessage.contextInfo;
    return {
        message: {
            key: {
                remoteJid: quoted.participant || quoted.stanzaId,
                fromMe: quoted.participant === (message.key.participant || message.key.remoteJid),
                id: quoted.stanzaId
            },
            message: quoted.quotedMessage,
            mtype: Object.keys(quoted.quotedMessage || {})[0]?.replace('Message', '') || 'text'
        },
        sender: quoted.participant
    };
}

// Runtime function for menu
function runtime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours}h ${minutes}m ${secs}s`;
}

// Generate interactive carousel menu - FIXED
async function generateCarouselMenu(conn, from, message) {
    try {
        console.log('📋 Generating carousel menu...');
        
        // Get all commands from the global commands Map
        const allCommands = global.commands || new Map();
        console.log(`📋 Found ${allCommands.size} commands in global`);
        
        // Get built-in commands
        const builtInCommands = [
            { name: 'ping', tags: ['utility'] },
            { name: 'prefix', tags: ['settings'] },
            { name: 'menu', tags: ['utility'] },
            { name: 'help', tags: ['utility'] },
            { name: 'RAMA-XMD', tags: ['utility'] }
        ];
        
        // Build command list from loaded commands
        const folderCommands = [];
        for (const [pattern, command] of allCommands.entries()) {
            if (pattern === 'menu' || pattern === 'help' || pattern === 'RAMA-XMD') continue;
            
            let tags = command.tags || ['general'];
            if (command.category) {
                tags = [command.category];
            }
            
            folderCommands.push({
                name: pattern,
                tags: tags
            });
        }
        
        console.log(`📋 Built-in commands: ${builtInCommands.length}, Folder commands: ${folderCommands.length}`);
        
        // Combine all commands
        const allCommandList = [...builtInCommands, ...folderCommands];
        console.log(`📋 Total commands: ${allCommandList.length}`);
        
        // Group commands by tags
        const commandsByTag = {};
        allCommandList.forEach(cmd => {
            cmd.tags.forEach(tag => {
                if (!commandsByTag[tag]) {
                    commandsByTag[tag] = [];
                }
                commandsByTag[tag].push(cmd);
            });
        });
        
        console.log(`📋 Found ${Object.keys(commandsByTag).length} command categories`);
        
        // Define emojis for tags
        const tagEmojis = {
            'utility': '🔧',
            'settings': '⚙️',
            'admin': '👑',
            'general': '📦',
            'fun': '🎮',
            'game': '🎲',
            'media': '🎬',
            'download': '⬇️',
            'group': '👥',
            'owner': '👤',
            'ai': '🤖',
            'tools': '🛠️',
            'search': '🔍',
            'info': 'ℹ️',
            'audio': '🎵',
            'text': '✍️',
            'anime': '🎌',
            'finance': '💰',
            'emoji': '😊'
        };
        
        // Prepare categories for carousel
        const categoriesRaw = [];
        for (const [tag, cmds] of Object.entries(commandsByTag)) {
            const emoji = tagEmojis[tag] || '🔹';
            const commandNames = cmds.map(cmd => cmd.name);
            categoriesRaw.push({
                name: `${emoji} ${tag.toUpperCase()}`,
                commands: commandNames
            });
        }
        
        // Sort categories alphabetically
        categoriesRaw.sort((a, b) => a.name.localeCompare(b.name));
        
        // Build carousel cards
        const CHUNK_SIZE = 12;
        const cards = [];
        
        // Get menu image
        let imageBuffer = null;
        let menuImage = null;
        try {
            const imagePath = path.join(__dirname, 'assets/bot_image.jpg');
            if (fs.existsSync(imagePath)) {
                imageBuffer = fs.readFileSync(imagePath);
                console.log('📸 Menu image loaded from assets');
            } else {
                console.log('📸 No local menu image found, using default URL');
            }
        } catch (error) {
            console.log('📸 Error loading menu image:', error.message);
        }
        
        // Generate image message if buffer exists
        if (imageBuffer) {
            try {
                const { generateWAMessageContent } = require('@whiskeysockets/baileys');
                const content = await generateWAMessageContent(
                    { image: imageBuffer },
                    { upload: conn.waUploadToServer }
                );
                menuImage = content.imageMessage;
            } catch (error) {
                console.error('❌ Error generating image message:', error);
            }
        }
        
        // First card: Bot info
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const secs = Math.floor(uptime % 60);
        const runtimeStr = `${hours}h ${minutes}m ${secs}s`;
        
        const infoDesc = `╔══[✦${BOT_NAME}✦]══╗
║✦ ↳ *NAME:* 🔥${BOT_NAME}🔥
║✦ ↳ *RUNTIME:* ${runtimeStr}
║✦ ↳ *VERSION:* v3.0.7
║✦ ↳ *OWNER:* 🧩${OWNER_NAME}🧩
║✦ ↳ *PREFIX:* ${PREFIX}
║✦ ↳ *TOTAL CMDS:* ${allCommandList.length}
╚═══════✦═══════╝`;
        
        cards.push({
            header: { 
                title: `${BOT_NAME} INFO`,
                hasMediaAttachment: !!menuImage,
                ...(menuImage ? { imageMessage: menuImage } : {})
            },
            body: { text: infoDesc },
            footer: { text: `Page 1` },
            nativeFlowMessage: {
                buttons: [
                    { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "📢 CHANNEL", url: "https://whatsapp.com/channel/0029Vb5ytZEE50UbwV7xBv1k" }) },
                    { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "🔗 REPO", url: REPO_LINK }) }
                ]
            }
        });
        
        // Process each category, splitting into multiple cards if needed
        let cardIndex = 1;
        for (const cat of categoriesRaw) {
            const total = cat.commands.length;
            const numChunks = Math.ceil(total / CHUNK_SIZE);
            for (let chunk = 0; chunk < numChunks; chunk++) {
                const start = chunk * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, total);
                const chunkCommands = cat.commands.slice(start, end);
                let cmdList = '';
                chunkCommands.forEach(cmd => {
                    cmdList += `║✦ ↳ ${PREFIX}${cmd}\n`;
                });
                const title = (chunk === 0) ? `${cat.name}` : `${cat.name} (cont.)`;
                const desc = `╔═[✦ ${title} ✦]═╗\n${cmdList}╚━━━━━━━━━━━━━━━━━━━✦`;
                cardIndex++;
                cards.push({
                    header: { 
                        title: `${title}`,
                        hasMediaAttachment: !!menuImage,
                        ...(menuImage ? { imageMessage: menuImage } : {})
                    },
                    body: { text: desc },
                    footer: { text: `Page ${cardIndex}` },
                    nativeFlowMessage: {
                        buttons: [
                            { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "📢 CHANNEL", url: "https://whatsapp.com/channel/0029Vb5ytZEE50UbwV7xBv1k" }) },
                            { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "🔗 REPO", url: REPO_LINK }) }
                        ]
                    }
                });
            }
        }
        
        // Build and send carousel
        console.log(`📋 Sending carousel with ${cards.length} cards`);
        
        const { generateWAMessageFromContent } = require('@whiskeysockets/baileys');
        const interactiveMsg = generateWAMessageFromContent(from, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        body: { text: `✨ ${BOT_NAME} ✨` },
                        footer: { text: `CYBER DARK BOT` },
                        carouselMessage: { cards }
                    }
                }
            }
        }, { quoted: message });
        
        await conn.relayMessage(from, interactiveMsg.message, { messageId: interactiveMsg.key.id });
        console.log('✅ Carousel menu sent successfully');
        return true;
        
    } catch (error) {
        console.error('❌ Carousel menu error:', error);
        console.error('Error stack:', error.stack);
        return false;
    }
}

// Fallback text menu
function generateFallbackMenu() {
    const allCommands = global.commands || new Map();
    
    const builtInCommands = [
        { name: 'ping', tags: ['utility'] },
        { name: 'prefix', tags: ['settings'] },
        { name: 'menu', tags: ['utility'] },
        { name: 'help', tags: ['utility'] },
        { name: 'RAMA-XMD', tags: ['utility'] }
    ];
    
    const folderCommands = [];
    for (const [pattern, command] of allCommands.entries()) {
        if (pattern === 'menu' || pattern === 'help' || pattern === 'RAMA-XMD') continue;
        
        let tags = command.tags || ['general'];
        if (command.category) {
            tags = [command.category];
        }
        
        folderCommands.push({
            name: pattern,
            tags: tags
        });
    }
    
    const allCommandList = [...builtInCommands, ...folderCommands];
    
    const commandsByTag = {};
    allCommandList.forEach(cmd => {
        cmd.tags.forEach(tag => {
            if (!commandsByTag[tag]) {
                commandsByTag[tag] = [];
            }
            commandsByTag[tag].push(cmd);
        });
    });
    
    const tagEmojis = {
        'utility': '🔧',
        'settings': '⚙️',
        'admin': '👑',
        'general': '📦',
        'fun': '🎮',
        'game': '🎲',
        'media': '🎬',
        'download': '⬇️',
        'group': '👥',
        'owner': '👤',
        'ai': '🤖',
        'tools': '🛠️',
        'search': '🔍',
        'info': 'ℹ️',
        'audio': '🎵',
        'text': '✍️',
        'anime': '🎌',
        'finance': '💰',
        'emoji': '😊'
    };
    
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const secs = Math.floor(uptime % 60);
    const runtimeStr = `${hours}h ${minutes}m ${secs}s`;
    
    let menuText = `
🚀 ${BOT_NAME} 🚀

📌 Prefix : ${PREFIX}
👤 Owner  : ${OWNER_NAME}
⏱️ Runtime: ${runtimeStr}
🔧 Total  : ${allCommandList.length} commands


📋 MENU LIST
───────────────────
`;

    for (const [tag, cmds] of Object.entries(commandsByTag)) {
        const emoji = tagEmojis[tag] || '🔹';
        menuText += `\n${emoji} ${tag.toUpperCase()}:\n`;
        for (const cmd of cmds) {
            menuText += `   ➤ ${PREFIX}${cmd.name}\n`;
        }
    }

    return menuText;
}

// Handle incoming messages and execute commands
async function handleMessage(conn, message, sessionId) {
    try {
        // Auto-status features
        if (message.key && message.key.remoteJid === 'status@broadcast') {
            if (AUTO_STATUS_SEEN === "true") {
                await conn.readMessages([message.key]).catch(console.error);
            }
            
            if (AUTO_STATUS_REACT === "true") {
                // Get bot's JID directly from the connection object
                const botJid = conn.user.id;
                const emojis = ['❤️', '💸', '😇', '🍂', '💥', '💯', '🔥', '💫', '💎', '💗', '🤍', '🖤', '👀', '🙌', '🙆', '🚩', '🥰', '💐', '😎', '🤎', '✅', '🫀', '🧡', '😁', '😄', '🌸', '🕊️', '🌷', '⛅', '🌟', '🗿', '🇳🇬', '💜', '💙', '🌝', '🖤', '💚'];
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                await conn.sendMessage(message.key.remoteJid, {
                    react: {
                        text: randomEmoji,
                        key: message.key,
                    } 
                }, { statusJidList: [message.key.participant, botJid] }).catch(console.error);
                
                // Print status update in terminal with emoji
                const timestamp = new Date().toLocaleTimeString();
                console.log(`[${timestamp}] ✅ Auto-liked a status with ${randomEmoji} emoji`);
            }                       
            
            if (AUTO_STATUS_REPLY === "true") {
                const user = message.key.participant;
                const text = `${AUTO_STATUS_MSG}`;
                await conn.sendMessage(user, { text: text, react: { text: '💜', key: message.key } }, { quoted: message }).catch(console.error);
            }
            
            // Store status media for forwarding
            if (message.message && (message.message.imageMessage || message.message.videoMessage)) {
                statusMediaStore.set(message.key.participant, {
                    message: message,
                    timestamp: Date.now()
                });
            }
            
            return;
        }

        if (!message.message) return;

        // Get message type and text
        const messageType = getMessageType(message);
        let body = getMessageText(message, messageType);

        // Get user-specific prefix or use default
        const userPrefix = userPrefixes.get(sessionId) || PREFIX;
        
        // Check if message starts with prefix
        if (!body.startsWith(userPrefix)) return;

        // Parse command and arguments
        const args = body.slice(userPrefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        console.log(`🔍 Detected command: ${commandName} from user: ${sessionId}`);

        // Handle built-in commands (only ping and prefix now)
        if (await handleBuiltInCommands(conn, message, commandName, args, sessionId)) {
            return;
        }

        // Find and execute command from commands folder
        if (commands.has(commandName)) {
            const command = commands.get(commandName);
            
            console.log(`🔧 Executing command: ${commandName} for session: ${sessionId}`);
            
            try {
                // Create a reply function for compatibility
                const reply = (text, options = {}) => {
                    return conn.sendMessage(message.key.remoteJid, { text }, { 
                        quoted: message, 
                        ...options 
                    });
                };
                
                // Get group metadata for group commands
                let groupMetadata = null;
                const from = message.key.remoteJid;
                const isGroup = from.endsWith('@g.us');
                
                if (isGroup) {
                    try {
                        groupMetadata = await conn.groupMetadata(from);
                    } catch (error) {
                        console.error("Error fetching group metadata:", error);
                    }
                }
                
                // Get quoted message if exists
                const quotedMessage = getQuotedMessage(message);
                
                // Prepare parameters in the format your commands expect
                const m = {
                    mentionedJid: message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [],
                    quoted: quotedMessage,
                    sender: message.key.participant || message.key.remoteJid
                };
                
                const q = body.slice(userPrefix.length + commandName.length).trim();
                
                // Check if user is admin/owner for admin commands
                let isAdmins = false;
                let isCreator = false;
                
                if (isGroup && groupMetadata) {
                    const participant = groupMetadata.participants.find(p => p.id === m.sender);
                    isAdmins = participant?.admin === 'admin' || participant?.admin === 'superadmin';
                    isCreator = participant?.admin === 'superadmin';
                }
                
                conn.ev.on('group-participants.update', async (update) => {
                    console.log("🔥 group-participants.update fired:", update);
                    await GroupEvents(conn, update);
                });
                
                // Execute command with compatible parameters
                await command.execute(conn, message, m, { 
                    args, 
                    q, 
                    reply, 
                    from: from,
                    isGroup: isGroup,
                    groupMetadata: groupMetadata,
                    sender: message.key.participant || message.key.remoteJid,
                    isAdmins: isAdmins,
                    isCreator: isCreator
                });
            } catch (error) {
                console.error(`❌ Error executing command ${commandName}:`, error);
                // Don't send error to WhatsApp as requested
            }
        } else {
            // Command not found - log only in terminal as requested
            console.log(`⚠️ Command not found: ${commandName}`);
        }
    } catch (error) {
        console.error("Error handling message:", error);
        // Don't send error to WhatsApp as requested
    }
}

// Handle built-in commands - ONLY ping and prefix now
async function handleBuiltInCommands(conn, message, commandName, args, sessionId) {
    try {
        const userPrefix = userPrefixes.get(sessionId) || PREFIX;
        const from = message.key.remoteJid;
        
        // Handle newsletter/channel messages differently
        if (from.endsWith('@newsletter')) {
            console.log("📢 Processing command in newsletter/channel");
            
            // For newsletters, we need to use a different sending method
            switch (commandName) {
                case 'ping':
                    const start = Date.now();
                    const end = Date.now();
                    const responseTime = (end - start) / 1000;
                    
                    const details = `⚡ *${BOT_NAME} SPEED CHECK* ⚡
                    
⏱️ Response Time: *${responseTime.toFixed(2)}s* ⚡
👤 Owner: *${OWNER_NAME}*`;

                    try {
                        if (conn.newsletterSend) {
                            await conn.newsletterSend(from, { text: details });
                        } else {
                            await conn.sendMessage(from, { text: details });
                        }
                    } catch (error) {
                        console.error("Error sending to newsletter:", error);
                    }
                    return true;
                    
                case 'prefix':
                    const senderId = message.key.participant || message.key.remoteJid;
                    const isOwner = await isOwnerOrSudo(senderId, conn, from);
                    if (!isOwner) {
                        try {
                            if (conn.newsletterSend) {
                                await conn.newsletterSend(from, { text: `❌ Owner only command` });
                            }
                        } catch (error) {
                            console.error("Error sending to newsletter:", error);
                        }
                        return true;
                    }
                    const currentPrefix = userPrefixes.get(sessionId) || PREFIX;
                    try {
                        if (conn.newsletterSend) {
                            await conn.newsletterSend(from, { text: `📌 Current prefix: ${currentPrefix}` });
                        }
                    } catch (error) {
                        console.error("Error sending to newsletter:", error);
                    }
                    return true;
                    
                default:
                    return false;
            }
        }
        
        // Regular chat/group message handling
        switch (commandName) {
            case 'ping':
            case 'speed':
                const start = Date.now();
                await conn.sendMessage(from, { 
                    text: `🏓 Pong! Checking speed...` 
                }, { quoted: message });
                const end = Date.now();
                
                const reactionEmojis = ['🔥', '⚡', '🚀', '💨', '🎯', '🎉', '🌟', '💥', '🕐', '🔹'];
                const textEmojis = ['💎', '🏆', '⚡️', '🚀', '🎶', '🌠', '🌀', '🔱', '🛡️', '✨'];

                const reactionEmoji = reactionEmojis[Math.floor(Math.random() * reactionEmojis.length)];
                let textEmoji = textEmojis[Math.floor(Math.random() * textEmojis.length)];

                while (textEmoji === reactionEmoji) {
                    textEmoji = textEmojis[Math.floor(Math.random() * textEmojis.length)];
                }

                await conn.sendMessage(from, { 
                    react: { text: textEmoji, key: message.key } 
                });

                const responseTime = (end - start) / 1000;

                const pingDetails = `⚡ *${BOT_NAME} SPEED CHECK* ⚡
                
⏱️ Response Time: *${responseTime.toFixed(2)}s* ${reactionEmoji}
👤 Owner: *${OWNER_NAME}*`;

                await conn.sendMessage(from, {
                    text: pingDetails,
                    contextInfo: {
                        externalAdReply: {
                            title: "⚡ RAMA-XMD Speed Test",
                            body: `${BOT_NAME} Performance Check`,
                            thumbnailUrl: MENU_IMAGE_URL,
                            sourceUrl: REPO_LINK,
                            mediaType: 1,
                            renderLargerThumbnail: true
                        }
                    }
                }, { quoted: message });
                return true;
                
            case 'prefix':
                const senderId = message.key.participant || message.key.remoteJid;
                const isOwner = await isOwnerOrSudo(senderId, conn, from);
                if (!isOwner) {
                    await conn.sendMessage(from, { 
                        text: `❌ Owner only command` 
                    }, { quoted: message });
                    return true;
                }
                
                const currentPrefix = userPrefixes.get(sessionId) || PREFIX;
                await conn.sendMessage(from, { 
                    text: `📌 Current prefix: ${currentPrefix}` 
                }, { quoted: message });
                return true;
                
            case 'menu':
            case 'help':
            case 'RAMA-XMD':
                console.log(`📋 Generating menu for ${commandName}...`);
                // Generate and send interactive carousel menu
                const success = await generateCarouselMenu(conn, from, message);
                if (!success) {
                    console.log('⚠️ Carousel menu failed, using fallback text menu');
                    // Fallback to simple text menu if carousel fails
                    const fallbackMenu = generateFallbackMenu();
                    await conn.sendMessage(from, {
                        text: fallbackMenu,
                        contextInfo: {
                            forwardingScore: 999,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: "120363401269012709@newsletter",
                                newsletterName: "RAMA-XMD",
                                serverMessageId: 200
                            },
                            externalAdReply: {
                                title: "📃 RAMA-XMD Command Menu",
                                body: `${BOT_NAME} - All Available Commands`,
                                thumbnailUrl: MENU_IMAGE_URL,
                                sourceUrl: REPO_LINK,
                                mediaType: 1,
                                renderLargerThumbnail: true
                            }
                        }
                    }, { quoted: message });
                    console.log('✅ Fallback text menu sent');
                }
                return true;
                
            default:
                return false;
        }
    } catch (error) {
        console.error("Error in built-in command:", error);
        return false;
    }
}

// Setup connection event handlers
function setupConnectionHandlers(conn, sessionId, io, saveCreds) {
    let hasShownConnectedMessage = false;
    let isLoggedOut = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;
    
    // Handle connection updates
    conn.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        
        console.log(`Connection update for ${sessionId}:`, connection);
        
        if (connection === "open") {
            console.log(`✅ WhatsApp connected for session: ${sessionId}`);
            console.log(`🟢 CONNECTED — ${BOT_NAME} is now active for ${sessionId}`);
            
            isUserLoggedIn = true;
            isLoggedOut = false;
            reconnectAttempts = 0;
            activeSockets++;
            broadcastStats();
            
            // Send connected event to frontend
            io.emit("linked", { sessionId });
            
            if (!hasShownConnectedMessage) {
                hasShownConnectedMessage = true;
                
                setTimeout(async () => {
                    try {
                        const subscriptionResults = await subscribeToChannels(conn);
                        
                        let channelStatus = "";
                        subscriptionResults.forEach((result, index) => {
                            const status = result.success ? "✅ Followed" : "❌ Not followed";
                            channelStatus += `📢 Channel ${index + 1}: ${status}\n`;
                        });

                        let name = "User";
                        try {
                            name = conn.user.name || "User";
                        } catch (error) {
                            console.log("Could not get user name:", error.message);
                        }
                        
                        let up = `
╔══════════════════════╗
║  🚀 ${BOT_NAME} 🚀  ║
╚══════════════════════╝

👋 Hey *${name}* 🤩  
🎉 Pairing Complete – You're good to go!  

📌 Prefix: ${PREFIX}  
${channelStatus}

                        `;

                        const userJid = `${conn.user.id.split(":")[0]}@s.whatsapp.net`;
                        await conn.sendMessage(userJid, { 
                            text: up,
                            contextInfo: {
                                mentionedJid: [userJid],
                                forwardingScore: 999,
                                externalAdReply: {
                                    title: `${BOT_NAME} Connected 🚀`,
                                    body: `⚡ Powered by ${OWNER_NAME}`,
                                    thumbnailUrl: MENU_IMAGE_URL,
                                    mediaType: 1,
                                    renderLargerThumbnail: true
                                }
                            }
                        });
                    } catch (error) {
                        console.error("Error in channel subscription or welcome message:", error);
                    }
                }, 3000);
            }
        }
        
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            
            if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                console.log(`🔁 Connection closed, attempting to reconnect session: ${sessionId} (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
                
                hasShownConnectedMessage = false;
                
                setTimeout(() => {
                    if (activeConnections.has(sessionId)) {
                        const { conn: existingConn } = activeConnections.get(sessionId);
                        try {
                            existingConn.ws.close();
                        } catch (e) {}
                        
                        initializeConnection(sessionId);
                    }
                }, 5000);
            } else {
                console.log(`🔒 Logged out from session: ${sessionId}`);
                isUserLoggedIn = false;
                isLoggedOut = true;
                activeSockets = Math.max(0, activeSockets - 1);
                broadcastStats();
                
                if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
                    // Delete from MongoDB on logout
                    await deleteSessionFromMongo(sessionId);
                    setTimeout(() => {
                        cleanupSession(sessionId, true);
                    }, 5000);
                }
                
                activeConnections.delete(sessionId);
                io.emit("unlinked", { sessionId });
            }
        }
    });

    // Handle credentials updates
    conn.ev.on("creds.update", async () => {
        if (saveCreds) {
            await saveCreds();
            // Save to MongoDB as backup
            const sessionDir = path.join(__dirname, "sessions", sessionId);
            const credsPath = path.join(sessionDir, 'creds.json');
            if (fs.existsSync(credsPath)) {
                try {
                    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                    const keysPath = path.join(sessionDir, 'keys.json');
                    const keys = fs.existsSync(keysPath) ? JSON.parse(fs.readFileSync(keysPath, 'utf8')) : null;
                    await saveSessionToMongo(sessionId, creds, keys);
                } catch (error) {
                    console.error(`❌ Failed to save session ${sessionId} to MongoDB:`, error.message);
                }
            }
        }
    });

    // Handle messages
    conn.ev.on("messages.upsert", async (m) => {
        try {
            const message = m.messages[0];
            
            const botJid = conn.user.id;
            const normalizedBotJid = botJid.includes(':') ? botJid.split(':')[0] + '@s.whatsapp.net' : botJid;
            
            const isFromBot = message.key.fromMe || 
                              (message.key.participant && message.key.participant === normalizedBotJid) ||
                              (message.key.remoteJid && message.key.remoteJid === normalizedBotJid);
            
            if (message.key.fromMe && !isFromBot) return;
            
            console.log(`📩 Received message from ${message.key.remoteJid}, fromMe: ${message.key.fromMe}, isFromBot: ${isFromBot}`);
            
            const from = message.key.remoteJid;
            
            if (from.endsWith('@newsletter')) {
                await handleMessage(conn, message, sessionId);
            } 
            else if (from.endsWith('@g.us')) {
                await handleMessage(conn, message, sessionId);
            }
            else if (from.endsWith('@s.whatsapp.net') || isFromBot) {
                await handleMessage(conn, message, sessionId);
            }
            
            const messageType = getMessageType(message);
            let messageText = getMessageText(message, messageType);
            
            if (!message.key.fromMe || isFromBot) {
                const timestamp = new Date(message.messageTimestamp * 1000).toLocaleTimeString();
                const isGroup = from.endsWith('@g.us');
                const sender = message.key.fromMe ? conn.user.id : (message.key.participant || message.key.remoteJid);
                
                if (isGroup) {
                    console.log(`[${timestamp}] [GROUP: ${from}] ${sender}: ${messageText} (${messageType})`);
                } else {
                    console.log(`[${timestamp}] [PRIVATE] ${sender}: ${messageText} (${messageType})`);
                }
            }
        } catch (error) {
            console.error("Error processing message:", error);
        }
    });

    // Auto View Status feature
    conn.ev.on("messages.upsert", async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.key.fromMe && msg.key.remoteJid === "status@broadcast") {
                await conn.readMessages([msg.key]);
                console.log("✅ Auto-viewed a status.");
            }
        } catch (e) {
            console.error("❌ AutoView failed:", e);
        }
    });

    // Auto Like Status feature
    conn.ev.on("messages.upsert", async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.key.fromMe && msg.key.remoteJid === "status@broadcast" && AUTO_STATUS_REACT === "true") {
                const botJid = conn.user.id;
                const emojis = ['❤️', '💸', '😇', '🍂', '💥', '💯', '🔥', '💫', '💎', '💗', '🤍', '🖤', '👀', '🙌', '🙆', '🚩', '🥰', '💐', '😎', '🤎', '✅', '🫀', '🧡', '😁', '😄', '🌸', '🕊️', '🌷', '⛅', '🌟', '🗿', '🇳🇬', '💜', '💙', '🌝', '🖤', '💚'];
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                
                await conn.sendMessage(msg.key.remoteJid, {
                    react: {
                        text: randomEmoji,
                        key: msg.key,
                    } 
                }, { statusJidList: [msg.key.participant, botJid] });
                
                const timestamp = new Date().toLocaleTimeString();
                console.log(`[${timestamp}] ✅ Auto-liked a status with ${randomEmoji} emoji`);
            }
        } catch (e) {
            console.error("❌ AutoLike failed:", e);
        }
    });
}

// Function to reinitialize connection
async function initializeConnection(sessionId) {
    try {
        const sessionDir = path.join(__dirname, "sessions", sessionId);
        
        if (!fs.existsSync(sessionDir)) {
            console.log(`Session directory not found for ${sessionId}, trying to restore from MongoDB...`);
            const mongoSession = await loadSessionFromMongo(sessionId);
            if (mongoSession && mongoSession.creds) {
                fs.mkdirSync(sessionDir, { recursive: true });
                fs.writeFileSync(path.join(sessionDir, 'creds.json'), JSON.stringify(mongoSession.creds, null, 2));
                if (mongoSession.keys) {
                    fs.writeFileSync(path.join(sessionDir, 'keys.json'), JSON.stringify(mongoSession.keys, null, 2));
                }
                console.log(`📥 Restored session ${sessionId} from MongoDB to local`);
            } else {
                console.log(`❌ No session found for ${sessionId} in MongoDB`);
                return;
            }
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();
        
        const conn = makeWASocket({
            logger: P({ level: "silent" }),
            printQRInTerminal: false,
            auth: state,
            version,
            browser: Browsers.macOS("Safari"),
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            maxIdleTimeMs: 60000,
            maxRetries: 10,
            markOnlineOnConnect: true,
            emitOwnEvents: true,
            defaultQueryTimeoutMs: 60000,
            syncFullHistory: false
        });

        activeConnections.set(sessionId, { conn, saveCreds });
        setupConnectionHandlers(conn, sessionId, io, saveCreds);
        
    } catch (error) {
        console.error(`Error reinitializing connection for ${sessionId}:`, error);
    }
}

// Clean up session folder (ONLY delete on logout)
function cleanupSession(sessionId, deleteEntireFolder = false) {
    const sessionDir = path.join(__dirname, "sessions", sessionId);
    
    if (fs.existsSync(sessionDir)) {
        if (deleteEntireFolder) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            console.log(`🗑️ Deleted session folder due to logout: ${sessionId}`);
        } else {
            console.log(`📁 Session preservation: Keeping all files for ${sessionId}`);
        }
    }
}

// API endpoint to get loaded commands
app.get("/api/commands", (req, res) => {
    const commandList = Array.from(commands.keys());
    res.json({ commands: commandList });
});

// Socket.io connection handling
io.on("connection", (socket) => {
    console.log("🔌 Client connected:", socket.id);
    
    socket.on("disconnect", () => {
        console.log("❌ Client disconnected:", socket.id);
    });
    
    socket.on("force-request-qr", () => {
        console.log("QR code regeneration requested");
    });
});

// Session preservation routine - NO AUTOMATIC CLEANUP
setInterval(() => {
    const sessionsDir = path.join(__dirname, "sessions");
    
    if (!fs.existsSync(sessionsDir)) return;
    
    const sessions = fs.readdirSync(sessionsDir);
    const now = Date.now();
    
    sessions.forEach(session => {
        const sessionPath = path.join(sessionsDir, session);
        const stats = fs.statSync(sessionPath);
        const age = now - stats.mtimeMs;
        
        if (age > 5 * 60 * 1000 && !activeConnections.has(session)) {
            console.log(`📊 Session ${session} is ${Math.round(age/60000)} minutes old - PRESERVED`);
        }
    });
}, 5 * 60 * 1000);

// Function to reload existing sessions on server restart
async function reloadExistingSessions() {
    console.log("🔄 Checking for existing sessions to reload...");
    
    const sessionsDir = path.join(__dirname, "sessions");
    
    if (!fs.existsSync(sessionsDir)) {
        console.log("📁 No sessions directory found, skipping session reload");
        return;
    }
    
    const sessions = fs.readdirSync(sessionsDir);
    console.log(`📂 Found ${sessions.length} session directories`);
    
    for (const sessionId of sessions) {
        const sessionDir = path.join(sessionsDir, sessionId);
        const stat = fs.statSync(sessionDir);
        
        if (stat.isDirectory()) {
            console.log(`🔄 Attempting to reload session: ${sessionId}`);
            
            try {
                const credsPath = path.join(sessionDir, "creds.json");
                if (fs.existsSync(credsPath)) {
                    await initializeConnection(sessionId);
                    console.log(`✅ Successfully reloaded session: ${sessionId}`);
                    
                    activeSockets++;
                    console.log(`📊 Active sockets increased to: ${activeSockets}`);
                } else {
                    console.log(`❌ No valid auth state found for session: ${sessionId}`);
                    console.log(`📁 Keeping session folder for potential reuse: ${sessionId}`);
                }
            } catch (error) {
                console.error(`❌ Failed to reload session ${sessionId}:`, error.message);
                console.log(`📁 Preserving session folder despite error: ${sessionId}`);
            }
        }
    }
    
    console.log("✅ Session reload process completed");
    broadcastStats();
}

// Start the server
server.listen(port, async () => {
    console.log(`🚀 ${BOT_NAME} server running on http://localhost:${port}`);
    console.log(`📱 WhatsApp bot initialized`);
    console.log(`🔧 Loaded ${commands.size} commands`);
    console.log(`📊 Starting with ${totalUsers} total users (persistent)`);
    
    // Initialize MongoDB session storage
    await initSessionMongo();
    
    await reloadExistingSessions();
});

// Graceful shutdown
let isShuttingDown = false;

function gracefulShutdown() {
  if (isShuttingDown) {
    console.log("🛑 Shutdown already in progress...");
    return;
  }
  
  isShuttingDown = true;
  console.log("\n🛑 Shutting down RAMA-XMD MD server...");
  
  savePersistentData();
  console.log(`💾 Saved persistent data: ${totalUsers} total users`);
  
  let connectionCount = 0;
  activeConnections.forEach((data, sessionId) => {
    try {
      data.conn.ws.close();
      console.log(`🔒 Closed WhatsApp connection for session: ${sessionId}`);
      connectionCount++;
    } catch (error) {}
  });
  
  console.log(`✅ Closed ${connectionCount} WhatsApp connections`);
  console.log(`📁 All session folders preserved for next server start`);
  
  // Close MongoDB connection
  if (sessionMongoClient) {
    sessionMongoClient.close().catch(() => {});
  }
  
  const shutdownTimeout = setTimeout(() => {
    console.log("⚠️  Force shutdown after timeout");
    process.exit(0);
  }, 3000);
  
  server.close(() => {
    clearTimeout(shutdownTimeout);
    console.log("✅ Server shut down gracefully");
    console.log("📁 Session folders preserved - they will be reloaded on next server start");
    process.exit(0);
  });
}

// Handle termination signals
process.on("SIGINT", () => {
  console.log("\nReceived SIGINT signal");
  gracefulShutdown();
});

process.on("SIGTERM", () => {
  console.log("\nReceived SIGTERM signal");
  gracefulShutdown();
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error.message);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});