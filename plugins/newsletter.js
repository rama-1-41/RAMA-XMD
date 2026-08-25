// plugins/newsletter.js
const axios = require('axios');

module.exports = {
    name: 'newsletter',
    description: 'Generate newsletter JID from link',
    category: 'tools',
    usage: '.newsletter <link> or reply to a link',
    handler: async (conn, message, config) => {
        try {
            const msg = message.message?.conversation || 
                       message.message?.extendedTextMessage?.text || '';
            const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            let link = '';

            // Check if user replied to a message with a link
            if (quotedMsg) {
                const quotedText = quotedMsg.conversation || 
                                  quotedMsg.extendedTextMessage?.text || '';
                if (quotedText.includes('whatsapp.com/channel/')) {
                    link = quotedText.match(/https?:\/\/[^\s]+/)[0];
                }
            }

            // Check if link is in the command
            const args = msg.split(' ');
            for (const arg of args) {
                if (arg.includes('whatsapp.com/channel/')) {
                    link = arg;
                    break;
                }
            }

            // Check if link is in the message without command
            if (!link && msg.includes('whatsapp.com/channel/')) {
                const match = msg.match(/https?:\/\/[^\s]+/);
                if (match) link = match[0];
            }

            if (!link) {
                return conn.sendMessage(message.key.remoteJid, {
                    text: `❌ *Please provide a WhatsApp Channel link!*\n\n📌 *Usage:*\n.newsletter https://whatsapp.com/channel/0029Vb...\n\nOr reply to a message containing the link.`
                });
            }

            // Extract channel ID from link
            const channelId = extractChannelId(link);
            if (!channelId) {
                return conn.sendMessage(message.key.remoteJid, {
                    text: `❌ *Invalid WhatsApp Channel link!*\n\nPlease provide a valid link like:\nhttps://whatsapp.com/channel/0029Vb...`
                });
            }

            // Generate newsletter JID
            const jid = generateNewsletterJid(channelId);

            // Try to get channel name (optional)
            let channelName = 'Unknown Channel';
            try {
                channelName = await getChannelName(channelId) || 'Unknown Channel';
            } catch {}

            // Send response
            const response = `📰 *Newsletter JID Generated!*

🔗 *Link:* ${link}
📱 *Channel ID:* ${channelId}
📬 *Newsletter JID:* \`${jid}\`
📛 *Channel Name:* ${channelName}

✅ Copy the JID and use it in your bot config!`;

            await conn.sendMessage(message.key.remoteJid, {
                text: response
            });

        } catch (error) {
            console.error('Newsletter error:', error);
            await conn.sendMessage(message.key.remoteJid, {
                text: `❌ *Error generating newsletter JID!*\n\nError: ${error.message}`
            });
        }
    }
};

// ─── Helper Functions ──────────────────────────────────────────

function extractChannelId(link) {
    try {
        const url = new URL(link);
        if (url.hostname !== 'whatsapp.com') return null;
        const path = url.pathname;
        if (!path.startsWith('/channel/')) return null;
        const id = path.replace('/channel/', '');
        if (id.length < 10) return null;
        return id;
    } catch {
        return null;
    }
}

function generateNewsletterJid(channelId) {
    // Standard WhatsApp newsletter JID format
    // Example: 120363401269012709@newsletter
    // The ID is usually 18 digits
    if (channelId.startsWith('0029')) {
        // Convert channel ID to newsletter JID
        const numericId = channelId.replace('0029', '120363');
        return `${numericId}@newsletter`;
    }
    // If it's already a numeric ID, just add @newsletter
    if (channelId.match(/^\d+$/)) {
        return `${channelId}@newsletter`;
    }
    // Default format
    return `${channelId}@newsletter`;
}

async function getChannelName(channelId) {
    try {
        // Try to fetch channel info
        const response = await axios.get(`https://whatsapp.com/channel/${channelId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 5000
        });
        
        // Try to extract channel name from HTML
        const html = response.data;
        const nameMatch = html.match(/<title>(.*?)<\/title>/);
        if (nameMatch) {
            let name = nameMatch[1].replace(' - WhatsApp Channel', '').trim();
            if (name) return name;
        }
        
        const jsonMatch = html.match(/<script[^>]*>.*?window\.__INITIAL_STATE__\s*=\s*({.*?});/s);
        if (jsonMatch) {
            try {
                const data = JSON.parse(jsonMatch[1]);
                if (data?.channel?.name) return data.channel.name;
            } catch {}
        }
        
        return null;
    } catch {
        return null;
    }
}