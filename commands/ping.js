// commands/ping.js
const BOT_NAME = process.env.BOT_NAME || "RAMA-XMD";
const OWNER_NAME = process.env.OWNER_NAME || "404unkown";

module.exports = {
    pattern: 'ping',
    alias: ['speed'],
    tags: ['utility'],
    description: 'Check bot response time',
    
    async execute(conn, message, m, options) {
        try {
            const { reply, q, args, from } = options;
            
            const start = Date.now();
            const pingMsg = await conn.sendMessage(from, { 
                text: `🏓 Pong! Checking speed...` 
            }, { quoted: message });
            const end = Date.now();
            
            const reactionEmojis = ['🔥', '⚡', '🚀', '💨', '🎯', '🎉', '🌟', '💥', '🕐', '🔹'];
            const textEmojis = ['💎', '🏆', '⚡️', '🚀', '🎶', '🌠', '🌀', '🔱', '🛡️', '✨'];
            
            const reactionEmoji = reactionEmojis[Math.floor(Math.random() * reactionEmojis.length)];
            let textEmoji = textEmojis[Math.floor(Math.random() * textEmojis.length)];
            
            // Ensure reaction and text emojis are different
            while (textEmoji === reactionEmoji) {
                textEmoji = textEmojis[Math.floor(Math.random() * textEmojis.length)];
            }
            
            // Send reaction
            await conn.sendMessage(from, { 
                react: { text: textEmoji, key: message.key } 
            });
            
            const responseTime = (end - start) / 1000;
            
            const details = `⚡ *${BOT_NAME} SPEED CHECK* ⚡
            
⏱️ Response Time: *${responseTime.toFixed(2)}s* ${reactionEmoji}
👤 Owner: *${OWNER_NAME}*`;
            
            // Send ping with external ad reply
            await conn.sendMessage(from, {
                text: details,
                contextInfo: {
                    externalAdReply: {
                        title: "⚡ RAMA-XMD Speed Test",
                        body: `${BOT_NAME} Performance Check`,
                        thumbnailUrl: process.env.MENU_IMAGE_URL || "https://files.catbox.moe/0dfeid.jpg",
                        sourceUrl: process.env.REPO_LINK || "https://github.com",
                        mediaType: 1,
                        renderLargerThumbnail: true
                    }
                }
            }, { quoted: message });
            
        } catch (error) {
            console.error("Error in ping command:", error);
        }
    }
};