// plugins/getpp.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

module.exports = {
    name: 'getpp',
    description: 'Get profile picture of any user',
    category: 'utility',
    usage: '.getpp [@mention] or reply to a message',
    aliases: ['.getdp', '.pp', '.avatar', '.profilepic', '.getavatar'],
    
    handler: async (sock, chatId, message, args) => {
        try {
            // Show typing indicator
            await sock.sendPresenceUpdate('composing', chatId);

            let targetJid = null;
            let targetName = 'User';
            let isGroup = chatId.endsWith('@g.us');

            // Method 1: Check if it's a reply to a message
            const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const quotedSender = message.message?.extendedTextMessage?.contextInfo?.participant;
            
            if (quotedSender) {
                targetJid = quotedSender;
            } else if (quotedMessage) {
                // Try to get sender from quoted message
                const quotedKey = message.message?.extendedTextMessage?.contextInfo?.stanzaId;
                if (quotedKey) {
                    // Sometimes the participant is in the contextInfo
                    targetJid = message.message?.extendedTextMessage?.contextInfo?.participant;
                }
            }

            // Method 2: Check for mentioned users
            const mentionedJids = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentionedJids.length > 0) {
                targetJid = mentionedJids[0];
            }

            // Method 3: Check if a JID is provided as argument
            if (!targetJid && args && args.length > 0) {
                const arg = args[0];
                // Check if it's a valid JID
                if (arg.includes('@') && (arg.endsWith('@s.whatsapp.net') || arg.endsWith('@g.us'))) {
                    targetJid = arg;
                }
                // Check if it's a phone number
                else if (/^\d+$/.test(arg)) {
                    targetJid = `${arg}@s.whatsapp.net`;
                }
            }

            // Method 4: If in group and no target, get sender's PP
            if (!targetJid) {
                targetJid = message.key.participant || message.key.remoteJid;
            }

            // If still no target, get the chat itself (group PP or own PP)
            if (!targetJid) {
                targetJid = chatId;
            }

            // Get user name
            try {
                const contactInfo = await sock.getContact(targetJid);
                if (contactInfo && contactInfo.name) {
                    targetName = contactInfo.name;
                } else if (contactInfo && contactInfo.pushname) {
                    targetName = contactInfo.pushname;
                } else {
                    // Try to get from group metadata
                    if (isGroup) {
                        const groupMetadata = await sock.groupMetadata(chatId);
                        const participant = groupMetadata.participants.find(p => p.id === targetJid);
                        if (participant && participant.notify) {
                            targetName = participant.notify;
                        }
                    }
                }
            } catch (e) {}

            // Get the profile picture
            let profilePicUrl = null;
            let profilePicBuffer = null;
            let isHighQuality = false;

            try {
                // Try to get high quality first
                profilePicUrl = await sock.profilePictureUrl(targetJid, 'image');
                isHighQuality = true;
            } catch (error) {
                try {
                    // Try standard quality
                    profilePicUrl = await sock.profilePictureUrl(targetJid, 'image');
                } catch (e) {
                    // User might not have a profile picture
                }
            }

            // Download the profile picture
            if (profilePicUrl) {
                try {
                    const response = await axios({
                        method: 'get',
                        url: profilePicUrl,
                        responseType: 'arraybuffer',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                    profilePicBuffer = Buffer.from(response.data);
                } catch (e) {
                    console.error('Error downloading profile pic:', e);
                }
            }

            if (!profilePicBuffer) {
                // Send a nice message when no profile picture is found
                const noPpMessage = `📷 *No Profile Picture Found*

❌ ${targetName} doesn't have a profile picture set.

📌 *Tips:*
• Make sure the user has set a profile picture
• Try mentioning the user directly
• Reply to a message from the user

📋 *Target ID:* \`${targetJid}\``;

                await sock.sendMessage(chatId, {
                    text: noPpMessage
                }, { quoted: message });
                return;
            }

            // Save the image temporarily
            const tempDir = path.join(process.cwd(), 'temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            
            const tempFile = path.join(tempDir, `pp_${Date.now()}.jpg`);
            fs.writeFileSync(tempFile, profilePicBuffer);

            // Generate additional information
            const fileSize = (profilePicBuffer.length / 1024).toFixed(2);
            const imageInfo = await getImageInfo(tempFile);

            // Send the profile picture with info
            const caption = `📷 *Profile Picture*

👤 *Name:* ${targetName}
📱 *JID:* \`${targetJid}\`
📦 *Size:* ${fileSize} KB
🖼️ *Dimensions:* ${imageInfo.width || 'N/A'}x${imageInfo.height || 'N/A'}
✨ *Quality:* ${isHighQuality ? 'HD' : 'Standard'}

${isGroup ? '👥 *From Group:* ' + (await getGroupName(sock, chatId)) : '💬 *Private Chat*'}`;

            // Send as image
            await sock.sendMessage(chatId, {
                image: profilePicBuffer,
                caption: caption,
                mimetype: 'image/jpeg'
            }, { quoted: message });

            // Also send as document for high quality
            if (isHighQuality && profilePicBuffer.length > 100 * 1024) {
                await sock.sendMessage(chatId, {
                    document: profilePicBuffer,
                    mimetype: 'image/jpeg',
                    fileName: `${targetName.replace(/\s/g, '_')}_profile.jpg`,
                    caption: '📎 *High Quality Image* (Download for full resolution)'
                }, { quoted: message });
            }

            // Clean up temp file
            try {
                fs.unlinkSync(tempFile);
            } catch (e) {}

            // Reset presence
            await sock.sendPresenceUpdate('available', chatId);

        } catch (error) {
            console.error('Error in getpp command:', error);
            await sock.sendMessage(chatId, {
                text: `❌ *Error getting profile picture!*\n\nError: ${error.message || 'Unknown error'}\n\nTry mentioning the user or replying to their message.`
            }, { quoted: message });
        }
    }
};

// Helper function to get image dimensions
async function getImageInfo(imagePath) {
    try {
        const sharp = require('sharp');
        const metadata = await sharp(imagePath).metadata();
        return {
            width: metadata.width,
            height: metadata.height,
            format: metadata.format,
            size: metadata.size
        };
    } catch (error) {
        // Sharp might not be installed, try using identify command
        try {
            const { stdout } = await execPromise(`identify -format "%wx%h" "${imagePath}"`);
            const [width, height] = stdout.split('x');
            return { width: parseInt(width), height: parseInt(height) };
        } catch (e) {
            return { width: 'Unknown', height: 'Unknown' };
        }
    }
}

// Helper function to get group name
async function getGroupName(sock, groupId) {
    try {
        const metadata = await sock.groupMetadata(groupId);
        return metadata.subject || 'Unknown Group';
    } catch (error) {
        return 'Unknown Group';
    }
}