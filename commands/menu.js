module.exports = {
    pattern: 'menu',
    alias: ['help', 'RAMA-XMD'],
    category: 'utility',
    desc: 'Show bot command menu',
    execute: async (conn, message, m, options) => {
        const { from } = options;
        const BOT_NAME = process.env.BOT_NAME || "RAMA-XMD";
        const OWNER_NAME = process.env.OWNER_NAME || "404unkown";
        const PREFIX = process.env.PREFIX || ".";
        const MENU_IMAGE_URL = process.env.MENU_IMAGE_URL || "https://chatgpt.com/s/m_6a608af947788191b82db90dd1712eab";
        const REPO_LINK = process.env.REPO_LINK || "https://github.com";

        const allCommands = global.commands || new Map();

        const builtInCommands = [
            { name: 'ping', category: 'utility' },
            { name: 'prefix', category: 'settings' },
            { name: 'menu', category: 'utility' },
            { name: 'help', category: 'utility' },
            { name: 'RAMA-XMD', category: 'utility' }
        ];

        const folderCommands = [];
        for (const [pattern, command] of allCommands.entries()) {
            if (pattern === 'menu' || pattern === 'help' || pattern === 'RAMA-XMD') continue;

            let category = command.category || 'general';
            if (command.tags && Array.isArray(command.tags)) {
                category = command.tags[0] || 'general';
            }

            folderCommands.push({
                name: pattern,
                category: category
            });
        }

        const allCommandList = [...builtInCommands, ...folderCommands];

        const commandsByCategory = {};
        allCommandList.forEach(cmd => {
            const cat = cmd.category || 'general';
            if (!commandsByCategory[cat]) {
                commandsByCategory[cat] = [];
            }
            commandsByCategory[cat].push(cmd);
        });

        const categoryEmojis = {
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
╔══════════════════════════════════════╗
║     🚀 ${BOT_NAME} 🚀     ║
╠══════════════════════════════════════╣
║  📌 Prefix : ${PREFIX.padEnd(20)}║
║  👤 Owner  : ${OWNER_NAME.padEnd(20)}║
║  ⏱️ Runtime: ${runtimeStr.padEnd(20)}║
║  🔧 Total  : ${allCommandList.length.toString().padEnd(20)}║
╠══════════════════════════════════════╣
║  📋 MENU LIST                       ║
╠══════════════════════════════════════╣
`;

        for (const [category, cmds] of Object.entries(commandsByCategory)) {
            const emoji = categoryEmojis[category] || '🔹';
            menuText += `║  ${emoji} ${category.toUpperCase().padEnd(30)}║\n`;
            for (const cmd of cmds) {
                menuText += `║     ➤ ${PREFIX}${cmd.name.padEnd(30)}║\n`;
            }
            menuText += `║  ${'─'.repeat(36)}║\n`;
        }

        menuText += `╚══════════════════════════════════════╝\n`;
        menuText += `\n✨ Powered by ${OWNER_NAME} ✨`;

        await conn.sendMessage(from, {
            text: menuText,
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
    }
};