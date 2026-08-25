// plugins/antidelete.js
const fs = require('fs');
const path = require('path');
const settings = require('../settings');

// Store deleted messages per user
const deletedMessages = new Map();
const antideleteStates = new Map(); // userId -> { enabled: boolean, chatId: string }

// ─── HELPERS ──────────────────────────────────────────────────
function getAntideleteData(userId) {
    const dataPath = `./data/${userId}/antidelete.json`;
    if (!fs.existsSync(dataPath)) {
        return { enabled: false, chatId: null };
    }
    try {
        return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    } catch {
        return { enabled: false, chatId: null };
    }
}

function saveAntideleteData(userId, data) {
    const dataDir = `./data/${userId}`;
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(`./data/${userId}/antidelete.json`, JSON.stringify(data, null, 2));
}

// ─── STORE MESSAGE ────────────────────────────────────────────
function storeMessage(sock, message) {
    try {
        const key = message.key;
        const chatId = key.remoteJid;
        const senderId = key.participant || key.remoteJid;
        const userId = senderId; // Use sender as userId for isolation
        
        if (!chatId || !key.id) return;
        
        const msgData = {
            id: key.id,
            chatId: chatId,
            sender: senderId,
            message: message.message,
            timestamp: Date.now()
        };
        
        // Store per user
        if (!deletedMessages.has(userId)) {
            deletedMessages.set(userId, new Map());
        }
        
        const userMessages = deletedMessages.get(userId);
        if (!userMessages.has(chatId)) {
            userMessages.set(chatId, new Map());
        }
        
        const chatMessages = userMessages.get(chatId);
        chatMessages.set(key.id, msgData);
        
        // Cleanup old messages (keep last 50 per chat)
        if (chatMessages.size > 50) {
            const keys = Array.from(chatMessages.keys());
            const oldestKey = keys[0];
            chatMessages.delete(oldestKey);
        }
    } catch (error) {
        console.error('Error storing message:', error);
    }
}

// ─── HANDLE MESSAGE REVOCATION ──────────────────────────────
async function handleMessageRevocation(sock, message) {
    try {
        const protocolMsg = message.message?.protocolMessage;
        if (!protocolMsg || protocolMsg.type !== 0) return;
        
        const key = protocolMsg.key;
        if (!key) return;
        
        const chatId = key.remoteJid;
        const senderId = key.participant || key.remoteJid;
        const userId = senderId;
        
        // Check if antidelete is enabled for this user/chat
        const userData = getAntideleteData(userId);
        if (!userData.enabled) return;
        
        // Check if it's the specific chat or all chats
        if (userData.chatId && userData.chatId !== chatId) return;
        
        // Get stored message
        const userMessages = deletedMessages.get(userId);
        if (!userMessages) return;
        
        const chatMessages = userMessages.get(chatId);
        if (!chatMessages) return;
        
        const storedMsg = chatMessages.get(key.id);
        if (!storedMsg) return;
        
        // Get user settings for formatting
        const userSettings = settings.getUserSettings(userId);
        const botName = userSettings.botName || 'RAMA-XMD';
        
        // Send the deleted message
        const msgType = Object.keys(storedMsg.message)[0];
        let text = `🗑️ *${botName} - Anti-Delete*\n\n`;
        text += `*Sender:* ${storedMsg.sender.split('@')[0]}\n`;
        text += `*Deleted Message:*\n`;
        
        // Handle different message types
        let content = '';
        if (storedMsg.message.conversation) {
            content = storedMsg.message.conversation;
        } else if (storedMsg.message.extendedTextMessage) {
            content = storedMsg.message.extendedTextMessage.text || '';
        } else if (storedMsg.message.imageMessage) {
            content = `📷 *Image*: ${storedMsg.message.imageMessage.caption || 'No caption'}`;
            // Send image with caption
            try {
                const buffer = await sock.downloadMediaMessage(storedMsg);
                if (buffer) {
                    await sock.sendMessage(chatId, {
                        image: buffer,
                        caption: text + content,
                        contextInfo: { mentionedJid: [storedMsg.sender] }
                    });
                    return;
                }
            } catch (e) {}
        } else if (storedMsg.message.videoMessage) {
            content = `🎥 *Video*: ${storedMsg.message.videoMessage.caption || 'No caption'}`;
            try {
                const buffer = await sock.downloadMediaMessage(storedMsg);
                if (buffer) {
                    await sock.sendMessage(chatId, {
                        video: buffer,
                        caption: text + content,
                        contextInfo: { mentionedJid: [storedMsg.sender] }
                    });
                    return;
                }
            } catch (e) {}
        } else if (storedMsg.message.stickerMessage) {
            content = `🎨 *Sticker*`;
            try {
                const buffer = await sock.downloadMediaMessage(storedMsg);
                if (buffer) {
                    await sock.sendMessage(chatId, {
                        sticker: buffer,
                        contextInfo: { mentionedJid: [storedMsg.sender] }
                    });
                    return;
                }
            } catch (e) {}
        } else {
            content = `📝 *Message type*: ${msgType}`;
        }
        
        // Send text message
        if (content) {
            await sock.sendMessage(chatId, {
                text: text + content,
                contextInfo: { mentionedJid: [storedMsg.sender] }
            });
        }
        
        // Remove from store after sending
        chatMessages.delete(key.id);
        
    } catch (error) {
        console.error('Error handling message revocation:', error);
    }
}

// ─── COMMAND HANDLER ──────────────────────────────────────────
async function handleAntideleteCommand(sock, chatId, message, args, userId) {
    try {
        // Check if user exists or use default
        const uid = userId || 'default';
        
        if (!args || args.toLowerCase() === 'status' || args === '') {
            const data = getAntideleteData(uid);
            const status = data.enabled ? '✅ *Enabled*' : '❌ *Disabled*';
            const chatInfo = data.chatId ? `\n📌 *Chat:* ${data.chatId}` : '\n📌 *All Chats*';
            
            await sock.sendMessage(chatId, {
                text: `🛡️ *Anti-Delete Settings*\n\nStatus: ${status}${chatInfo}\n\n*Usage:*\n.antidelete on - Enable for all chats\n.antidelete off - Disable\n.antidelete here - Enable for this chat only\n.antidelete status - Check settings`
            });
            return;
        }
        
        const action = args.toLowerCase();
        
        if (action === 'on') {
            saveAntideleteData(uid, { enabled: true, chatId: null });
            await sock.sendMessage(chatId, {
                text: `✅ *Anti-Delete enabled* for all chats!`
            });
        } else if (action === 'off') {
            saveAntideleteData(uid, { enabled: false, chatId: null });
            await sock.sendMessage(chatId, {
                text: `❌ *Anti-Delete disabled*`
            });
        } else if (action === 'here' || action === 'this') {
            saveAntideleteData(uid, { enabled: true, chatId: chatId });
            await sock.sendMessage(chatId, {
                text: `✅ *Anti-Delete enabled* for this chat only!`
            });
        } else {
            await sock.sendMessage(chatId, {
                text: `❌ *Invalid option!*\n\n*Usage:*\n.antidelete on - Enable for all chats\n.antidelete off - Disable\n.antidelete here - Enable for this chat only\n.antidelete status - Check settings`
            });
        }
        
    } catch (error) {
        console.error('Error in antidelete command:', error);
        await sock.sendMessage(chatId, {
            text: `❌ Error: ${error.message}`
        });
    }
}

// ─── EXPORT ────────────────────────────────────────────────────
module.exports = {
    storeMessage,
    handleMessageRevocation,
    handleAntideleteCommand,
    getAntideleteData,
    saveAntideleteData
};