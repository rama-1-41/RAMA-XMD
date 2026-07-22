module.exports = {
    pattern: 'ping',
    alias: ['speed'],
    category: 'utility',
    desc: 'Check bot response time',
    execute: async (conn, message, m, options) => {
        const { from, reply } = options;
        const BOT_NAME = process.env.BOT_NAME || "RAMA-XMD";
        const OWNER_NAME = process.env.OWNER_NAME || "404unkown";
        const MENU_IMAGE_URL = process.env.MENU_IMAGE_URL || "https://files.catbox.moe/0dfeid.jpg";
        const REPO_LINK = process.env.REPO_LINK || "https://github.com";

        const start = Date.now();
        await reply('🏓 Pong! Checking speed...');
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
    }
};