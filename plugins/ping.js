const os = require('os');
const settings = require('../settings.js');

const botNameStyles = [
    "𝘙𝘈𝘔𝘈-𝘟𝘔𝘋",
    "𝙍𝘼𝙈𝘼-𝙓𝙈𝘋",
    "🆁🅰🅼🅰-🆇🅼🅳",
    "🅁🄰🄼🄰-🅇🄼🄳",
    "𝕽𝕬𝕸𝕬-𝕏𝕸𝕯",
    "𝑹𝑨𝑴𝑨-𝑿𝑴𝑫",
    "ⓇⒶⓂⒶ-ⓍⓂⒹ",
    "𝐑𝐀𝐌𝐀-𝐗𝐌𝐃",
    "ＲＡＭＡ－ＸＭＤ",
    "𝓡𝓐𝓜𝓐-𝓧𝓜𝓓"
];

let currentStyleIndex = 0;

async function pingCommand(sock, chatId, message) {
    try {
        const start = Date.now();

        const reactionEmojis = ['🔥','⚡','🚀','💨','🎯','🎉','🌟','💥','🕐','🔹'];
        const textEmojis = ['💎','🏆','⚡️','🚀','🎶','🌠','🌀','🔱','🛡️','✨'];

        let reactionEmoji = reactionEmojis[Math.floor(Math.random() * reactionEmojis.length)];
        let textEmoji = textEmojis[Math.floor(Math.random() * textEmojis.length)];
        if (textEmoji === reactionEmoji) textEmoji = textEmojis[Math.floor(Math.random() * textEmojis.length)];

        // React to the message
        await sock.sendMessage(chatId, { react: { text: textEmoji, key: message.key } });

        const responseTime = Date.now() - start;
        const fancyBotName = botNameStyles[currentStyleIndex];
        currentStyleIndex = (currentStyleIndex + 1) % botNameStyles.length;

        // Send the speed message
        await sock.sendMessage(chatId, { 
            text: `> *${fancyBotName} SPEED: ${responseTime}ms ${reactionEmoji}*`,
            contextInfo: { 
                mentionedJid: [message.key.remoteJid],
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363403380688821@newsletter',
                    newsletterName: "𝐑𝐀𝐌𝐀-𝐗𝐌𝐃",
                    serverMessageId: 143
                }
            } 
        }, { quoted: message });

    } catch (error) {
        console.error('Error in ping command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to get bot status.' });
    }
}

module.exports = pingCommand;