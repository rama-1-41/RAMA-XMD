// commands/menu.js – Interactive carousel menu with dynamic commands
const fs = require('fs');
const path = require('path');
const {
  generateWAMessageContent,
  generateWAMessageFromContent
} = require('@whiskeysockets/baileys');

// Bot configuration
const BOT_NAME = process.env.BOT_NAME || "RAMA-XMD";
const OWNER_NAME = process.env.OWNER_NAME || "404unkown";
const PREFIX = process.env.PREFIX || ".";
const REPO_LINK = process.env.REPO_LINK || "https://github.com";
const MENU_IMAGE_URL = process.env.MENU_IMAGE_URL || "https://files.catbox.moe/0dfeid.jpg";

// Runtime function
function runtime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours}h ${minutes}m ${secs}s`;
}

module.exports = {
    pattern: 'menu',
    alias: ['help', 'RAMA-XMD'],
    tags: ['utility'],
    description: 'Show all available commands with interactive carousel',
    
    async execute(conn, message, m, options) {
        try {
            const { reply, q, args, from, isGroup, groupMetadata, sender } = options;
            
            // Get all commands from the global commands Map (loaded by servers.js)
            const allCommands = global.commands || new Map();
            
            // Get built-in commands that are hardcoded in servers.js
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
                // Skip the menu command itself to avoid duplication
                if (pattern === 'menu' || pattern === 'help' || pattern === 'RAMA-XMD') continue;
                folderCommands.push({
                    name: pattern,
                    tags: command.tags || ['general']
                });
            }
            
            // Combine built-in and folder commands
            const allCommandList = [...builtInCommands, ...folderCommands];
            
            // Group commands by tags dynamically
            const commandsByTag = {};
            allCommandList.forEach(cmd => {
                cmd.tags.forEach(tag => {
                    if (!commandsByTag[tag]) {
                        commandsByTag[tag] = [];
                    }
                    commandsByTag[tag].push(cmd);
                });
            });
            
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
            try {
                const imagePath = path.join(__dirname, '../assets/bot_image.jpg');
                if (fs.existsSync(imagePath)) {
                    imageBuffer = fs.readFileSync(imagePath);
                }
            } catch (error) {
                console.log("No local image found, using URL instead");
            }
            
            async function getImageMessage(buffer) {
                if (!buffer) return null;
                try {
                    const content = await generateWAMessageContent(
                        { image: buffer },
                        { upload: conn.waUploadToServer }
                    );
                    return content.imageMessage;
                } catch (error) {
                    console.error("Error generating image message:", error);
                    return null;
                }
            }
            
            const menuImage = imageBuffer ? await getImageMessage(imageBuffer) : null;
            
            // First card: Bot info
            const infoDesc = `╔══[✦${BOT_NAME}✦]══╗
║✦ ↳ *NAME:* 🔥${BOT_NAME}🔥
║✦ ↳ *RUNTIME:* ${runtime(process.uptime())}
║✦ ↳ *VERSION:* v3.0.7
║✦ ↳ *OWNER:* 🧩${OWNER_NAME}🧩
║✦ ↳ *PREFIX:* ${PREFIX}
║✦ ↳ *TOTAL CMDS:* ${allCommandList.length}
╚═══════✦═══════╝`;
            
            cards.push({
                header: { title: `${BOT_NAME} INFO`, hasMediaAttachment: !!menuImage, imageMessage: menuImage },
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
                        header: { title: `${title}`, hasMediaAttachment: !!menuImage, imageMessage: menuImage },
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
            
        } catch (error) {
            console.error('❌ Menu error:', error);
            // Fallback to simple text menu if carousel fails
            try {
                const { reply } = options;
                const fallbackMenu = generateFallbackMenu();
                await conn.sendMessage(from, { text: fallbackMenu }, { quoted: message });
            } catch (fallbackError) {
                console.error('❌ Fallback menu also failed:', fallbackError);
            }
        }
    }
};

// Fallback text menu in case carousel fails
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
        folderCommands.push({
            name: pattern,
            tags: command.tags || ['general']
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
    };
    
    let menuText = `╔══════════════════════════════════════╗\n`;
    menuText += `║     🚀 ${BOT_NAME} 🚀     ║\n`;
    menuText += `╠══════════════════════════════════════╣\n`;
    menuText += `║  📌 Prefix : ${PREFIX.padEnd(20)}║\n`;
    menuText += `║  👤 Owner  : ${OWNER_NAME.padEnd(20)}║\n`;
    menuText += `║  🔧 Total  : ${allCommandList.length.toString().padEnd(20)}║\n`;
    menuText += `╠══════════════════════════════════════╣\n`;
    menuText += `║  📋 MENU LIST                       ║\n`;
    menuText += `╠══════════════════════════════════════╣\n`;
    
    for (const [tag, cmds] of Object.entries(commandsByTag)) {
        const emoji = tagEmojis[tag] || '🔹';
        menuText += `║  ${emoji} ${tag.toUpperCase().padEnd(30)}║\n`;
        for (const cmd of cmds) {
            menuText += `║     ➤ ${PREFIX}${cmd.name.padEnd(30)}║\n`;
        }
        menuText += `║  ${'─'.repeat(36)}║\n`;
    }
    
    menuText += `╚══════════════════════════════════════╝\n`;
    menuText += `\n✨ Powered by ${OWNER_NAME} ✨`;
    
    return menuText;
}