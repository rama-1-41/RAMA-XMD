// plugins/antidelete.js - Complete Anti-Delete + Auto-Status Saver
const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// ─── STORE ──────────────────────────────────────────────────
const deletedMessages = new Map();
const antideleteStates = new Map();
const statusStore = new Map(); // Store viewed statuses

// ─── HELPERS ──────────────────────────────────────────────────
function getAntideleteData(userId) {
    const dataPath = `./data/${userId}/antidelete.json`;
    if (!fs.existsSync(dataPath)) {
        return { enabled: false, chatId: null, saveStatus: true, ownerJid: null };
    }
    try {
        return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    } catch {
        return { enabled: false, chatId: null, saveStatus: true, ownerJid: null };
    }
}

function saveAntideleteData(userId, data) {
    const dataDir = `./data/${userId}`;
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(`./data/${userId}/antidelete.json`, JSON.stringify(data, null, 2));
}

function getStatusStorePath(userId) {
    const dir = `./data/${userId}/statuses`;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

// ─── DOWNLOAD MEDIA ──────────────────────────────────────────
async function downloadMedia(message, type) {
    try {
        const stream = await downloadContentFromMessage(message, type);
        const buffer = [];
        for await (const chunk of stream) {
            buffer.push(chunk);
        }
        return Buffer.concat(buffer);
    } catch (error) {
        console.error('Download error:', error);
        return null;
    }
}

// ─── STORE MESSAGE ────────────────────────────────────────────
function storeMessage(sock, message) {
    try {
        const key = message.key;
        const chatId = key.remoteJid;
        const senderId = key.participant || key.remoteJid;
        const userId = senderId;

        if (!chatId || !key.id) return;

        const msgData = {
            id: key.id,
            chatId: chatId,
            sender: senderId,
            message: message.message,
            timestamp: Date.now(),
            type: Object.keys(message.message || {})[0] || 'unknown'
        };

        if (!deletedMessages.has(userId)) {
            deletedMessages.set(userId, new Map());
        }

        const userMessages = deletedMessages.get(userId);
        if (!userMessages.has(chatId)) {
            userMessages.set(chatId, new Map());
        }

        const chatMessages = userMessages.get(chatId);
        chatMessages.set(key.id, msgData);

        // Keep last 100 messages per chat
        if (chatMessages.size > 100) {
            const keys = Array.from(chatMessages.keys());
            const oldestKey = keys[0];
            chatMessages.delete(oldestKey);
        }
    } catch (error) {
        console.error('Error storing message:', error);
    }
}

// ─── HANDLE STATUS UPDATE (Auto-save viewed statuses) ──────
async function handleStatusUpdate(sock, status) {
    try {
        const userId = sock?.user?.id?.split(':')[0] + '@s.whatsapp.net' || 'default';
        const data = getAntideleteData(userId);
        
        if (!data.saveStatus) return;

        const statuses = status?.statuses || [];
        if (!statuses.length) return;

        const ownerJid = data.ownerJid || userId;

        for (const statusMsg of statuses) {
            try {
                const statusId = statusMsg.id;
                const senderId = statusMsg.participant || statusMsg.remoteJid;
                const timestamp = statusMsg.timestamp || Date.now();
                const message = statusMsg.message || {};
                const msgType = Object.keys(message)[0] || 'unknown';

                // Check if already saved
                const statusDir = getStatusStorePath(userId);
                const statusFile = path.join(statusDir, `${statusId}.json`);
                if (fs.existsSync(statusFile)) continue;

                // Save status metadata
                const statusData = {
                    id: statusId,
                    sender: senderId,
                    timestamp: timestamp,
                    type: msgType,
                    viewedAt: new Date().toISOString()
                };

                let mediaBuffer = null;
                let caption = '';

                // Download media if exists
                if (msgType === 'imageMessage') {
                    const imgMsg = message.imageMessage;
                    mediaBuffer = await downloadMedia(imgMsg, 'image');
                    caption = imgMsg.caption || '';
                    statusData.caption = caption;
                    statusData.mimeType = imgMsg.mimetype || 'image/jpeg';
                } else if (msgType === 'videoMessage') {
                    const vidMsg = message.videoMessage;
                    mediaBuffer = await downloadMedia(vidMsg, 'video');
                    caption = vidMsg.caption || '';
                    statusData.caption = caption;
                    statusData.mimeType = vidMsg.mimetype || 'video/mp4';
                } else if (msgType === 'audioMessage') {
                    const audMsg = message.audioMessage;
                    mediaBuffer = await downloadMedia(audMsg, 'audio');
                    statusData.mimeType = audMsg.mimetype || 'audio/mpeg';
                } else if (msgType === 'stickerMessage') {
                    const stkMsg = message.stickerMessage;
                    mediaBuffer = await downloadMedia(stkMsg, 'sticker');
                    statusData.mimeType = stkMsg.mimetype || 'image/webp';
                } else if (msgType === 'documentMessage') {
                    const docMsg = message.documentMessage;
                    mediaBuffer = await downloadMedia(docMsg, 'document');
                    statusData.fileName = docMsg.fileName || 'document';
                    statusData.mimeType = docMsg.mimetype || 'application/octet-stream';
                } else if (msgType === 'conversation' || msgType === 'extendedTextMessage') {
                    const text = message.conversation || message.extendedTextMessage?.text || '';
                    statusData.text = text;
                }

                // Save to file
                fs.writeFileSync(statusFile, JSON.stringify(statusData, null, 2));

                // Send to owner's DM
                if (ownerJid && sock) {
                    let statusText = `📱 *New Status Saved!*\n\n`;
                    statusText += `👤 *From:* ${senderId.split('@')[0]}\n`;
                    statusText += `⏰ *Time:* ${new Date(timestamp).toLocaleString()}\n`;
                    statusText += `📁 *Type:* ${msgType}\n`;

                    if (caption) statusText += `📝 *Caption:* ${caption}\n`;
                    if (statusData.text) statusText += `📝 *Text:* ${statusData.text}\n`;
                    statusText += `\n📌 *Saved to:* data/${userId}/statuses/${statusId}`;

                    if (mediaBuffer) {
                        // Send media
                        if (msgType === 'imageMessage') {
                            await sock.sendMessage(ownerJid, {
                                image: mediaBuffer,
                                caption: statusText,
                                contextInfo: { mentionedJid: [senderId] }
                            });
                        } else if (msgType === 'videoMessage') {
                            await sock.sendMessage(ownerJid, {
                                video: mediaBuffer,
                                caption: statusText,
                                contextInfo: { mentionedJid: [senderId] }
                            });
                        } else if (msgType === 'audioMessage') {
                            await sock.sendMessage(ownerJid, {
                                audio: mediaBuffer,
                                mimetype: statusData.mimeType,
                                ptt: false,
                                contextInfo: { mentionedJid: [senderId] }
                            });
                            // Also send text
                            await sock.sendMessage(ownerJid, { text: statusText });
                        } else if (msgType === 'stickerMessage') {
                            await sock.sendMessage(ownerJid, {
                                sticker: mediaBuffer,
                                contextInfo: { mentionedJid: [senderId] }
                            });
                            await sock.sendMessage(ownerJid, { text: statusText });
                        } else if (msgType === 'documentMessage') {
                            await sock.sendMessage(ownerJid, {
                                document: mediaBuffer,
                                fileName: statusData.fileName || 'document',
                                mimetype: statusData.mimeType,
                                caption: statusText,
                                contextInfo: { mentionedJid: [senderId] }
                            });
                        }
                    } else {
                        // Text-only status
                        await sock.sendMessage(ownerJid, { text: statusText });
                    }
                }

                console.log(`✅ Status saved: ${statusId} from ${senderId}`);

            } catch (error) {
                console.error('Error processing status:', error);
            }
        }

    } catch (error) {
        console.error('Error in handleStatusUpdate:', error);
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

        const data = getAntideleteData(userId);
        if (!data.enabled) return;

        if (data.chatId && data.chatId !== chatId) return;

        const userMessages = deletedMessages.get(userId);
        if (!userMessages) return;

        const chatMessages = userMessages.get(chatId);
        if (!chatMessages) return;

        const storedMsg = chatMessages.get(key.id);
        if (!storedMsg) return;

        const userSettings = settings.getUserSettings(userId);
        const botName = userSettings.botName || 'RAMA-XMD';
        const ownerJid = data.ownerJid || userId;

        // Get deleted message content
        const msgType = storedMsg.type || 'unknown';
        let text = `🗑️ *${botName} - Anti-Delete Detected!*\n\n`;
        text += `👤 *Sender:* ${storedMsg.sender.split('@')[0]}\n`;
        text += `⏰ *Time:* ${new Date(storedMsg.timestamp).toLocaleString()}\n`;
        text += `📁 *Type:* ${msgType}\n\n`;
        text += `*Deleted Message:*\n`;

        let mediaBuffer = null;
        let content = '';

        // Handle different message types
        if (storedMsg.message.conversation) {
            content = storedMsg.message.conversation;
        } else if (storedMsg.message.extendedTextMessage) {
            content = storedMsg.message.extendedTextMessage.text || '';
        } else if (storedMsg.message.imageMessage) {
            const imgMsg = storedMsg.message.imageMessage;
            content = imgMsg.caption || 'No caption';
            mediaBuffer = await downloadMedia(imgMsg, 'image');
        } else if (storedMsg.message.videoMessage) {
            const vidMsg = storedMsg.message.videoMessage;
            content = vidMsg.caption || 'No caption';
            mediaBuffer = await downloadMedia(vidMsg, 'video');
        } else if (storedMsg.message.stickerMessage) {
            const stkMsg = storedMsg.message.stickerMessage;
            mediaBuffer = await downloadMedia(stkMsg, 'sticker');
            content = '🎨 Sticker';
        } else if (storedMsg.message.audioMessage) {
            const audMsg = storedMsg.message.audioMessage;
            mediaBuffer = await downloadMedia(audMsg, 'audio');
            content = `🎵 Audio (${audMsg.seconds || '?'}s)`;
        } else if (storedMsg.message.documentMessage) {
            const docMsg = storedMsg.message.documentMessage;
            mediaBuffer = await downloadMedia(docMsg, 'document');
            content = `📄 ${docMsg.fileName || 'Document'}`;
        } else if (storedMsg.message.viewOnceMessage) {
            const viewOnce = storedMsg.message.viewOnceMessage?.message || {};
            content = '👁️ View-Once Message';
            // Try to get view-once content
            const voType = Object.keys(viewOnce)[0] || 'unknown';
            text += `\n*View-Once Type:* ${voType}\n`;
        } else {
            content = `📝 ${msgType}`;
        }

        // Send to chat where message was deleted
        const sendToChat = async (chatId, text, media, caption) => {
            if (media) {
                const msgType = storedMsg.type || 'unknown';
                if (msgType === 'imageMessage') {
                    await sock.sendMessage(chatId, { image: media, caption: text + caption });
                } else if (msgType === 'videoMessage') {
                    await sock.sendMessage(chatId, { video: media, caption: text + caption });
                } else if (msgType === 'stickerMessage') {
                    await sock.sendMessage(chatId, { sticker: media });
                    await sock.sendMessage(chatId, { text: text + 'Sticker' });
                } else if (msgType === 'audioMessage') {
                    await sock.sendMessage(chatId, { audio: media, mimetype: 'audio/mpeg' });
                    await sock.sendMessage(chatId, { text: text + content });
                } else if (msgType === 'documentMessage') {
                    await sock.sendMessage(chatId, { document: media, fileName: content, caption: text + content });
                }
            } else {
                await sock.sendMessage(chatId, { text: text + content });
            }
        };

        // Send to chat
        await sendToChat(chatId, text, mediaBuffer, content);

        // Also send to owner's DM
        if (ownerJid !== chatId) {
            await sendToChat(ownerJid, `📩 *Deleted Message Forwarded*\n\n` + text, mediaBuffer, content);
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
        const uid = userId || 'default';
        const sender = message.key.participant || message.key.remoteJid;
        const ownerJid = sender;

        if (!args || args.toLowerCase() === 'status' || args === '') {
            const data = getAntideleteData(uid);
            const status = data.enabled ? '✅ *Enabled*' : '❌ *Disabled*';
            const chatInfo = data.chatId ? `\n📌 *Chat:* ${data.chatId}` : '\n📌 *All Chats*';
            const saveStatus = data.saveStatus ? '✅ *Enabled*' : '❌ *Disabled*';

            await sock.sendMessage(chatId, {
                text: `🛡️ *Anti-Delete Settings*\n\n` +
                      `🗑️ *Anti-Delete:* ${status}${chatInfo}\n` +
                      `💾 *Auto-Save Status:* ${saveStatus}\n` +
                      `👤 *Owner:* ${ownerJid}\n\n` +
                      `*Commands:*\n` +
                      `.antidelete on - Enable all chats\n` +
                      `.antidelete off - Disable\n` +
                      `.antidelete here - Enable this chat\n` +
                      `.antidelete status - Show settings\n` +
                      `.antidelete savestatus on/off - Toggle auto-save\n` +
                      `.antidelete sendto <jid> - Set DM destination`
            });
            return;
        }

        const action = args.toLowerCase();
        const data = getAntideleteData(uid);

        if (action === 'on') {
            saveAntideleteData(uid, { ...data, enabled: true, chatId: null });
            await sock.sendMessage(chatId, { text: `✅ *Anti-Delete enabled* for all chats!` });
        } else if (action === 'off') {
            saveAntideleteData(uid, { ...data, enabled: false, chatId: null });
            await sock.sendMessage(chatId, { text: `❌ *Anti-Delete disabled*` });
        } else if (action === 'here' || action === 'this') {
            saveAntideleteData(uid, { ...data, enabled: true, chatId: chatId });
            await sock.sendMessage(chatId, { text: `✅ *Anti-Delete enabled* for this chat only!` });
        } else if (action === 'savestatus' && args.split(' ')[1]) {
            const statusAction = args.split(' ')[1].toLowerCase();
            if (statusAction === 'on') {
                saveAntideleteData(uid, { ...data, saveStatus: true });
                await sock.sendMessage(chatId, { text: `✅ *Auto-save status* enabled!` });
            } else if (statusAction === 'off') {
                saveAntideleteData(uid, { ...data, saveStatus: false });
                await sock.sendMessage(chatId, { text: `❌ *Auto-save status* disabled!` });
            } else {
                await sock.sendMessage(chatId, { text: `❌ Usage: .antidelete savestatus on/off` });
            }
        } else if (action === 'sendto' && args.split(' ')[1]) {
            const jid = args.split(' ')[1];
            if (jid.includes('@') || jid.includes('s.whatsapp.net')) {
                saveAntideleteData(uid, { ...data, ownerJid: jid });
                await sock.sendMessage(chatId, { text: `✅ *DM destination set* to: ${jid}` });
            } else {
                await sock.sendMessage(chatId, { text: `❌ Invalid JID. Use full JID like: 123456789@s.whatsapp.net` });
            }
        } else {
            await sock.sendMessage(chatId, {
                text: `❌ *Invalid option!*\n\n*Commands:*\n` +
                      `.antidelete on - Enable all chats\n` +
                      `.antidelete off - Disable\n` +
                      `.antidelete here - Enable this chat\n` +
                      `.antidelete status - Show settings\n` +
                      `.antidelete savestatus on/off - Toggle auto-save\n` +
                      `.antidelete sendto <jid> - Set DM destination`
            });
        }

    } catch (error) {
        console.error('Error in antidelete command:', error);
        await sock.sendMessage(chatId, { text: `❌ Error: ${error.message}` });
    }
}

// ─── EXPORT ────────────────────────────────────────────────────
module.exports = {
    storeMessage,
    handleMessageRevocation,
    handleAntideleteCommand,
    handleStatusUpdate,
    getAntideleteData,
    saveAntideleteData,
    downloadMedia
};