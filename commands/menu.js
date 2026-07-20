// commands/menu.js – Interactive carousel menu with dynamic commands
const fs = require('fs');
const path = require('path');
const {
  generateWAMessageContent,
  generateWAMessageFromContent
} = require('@whiskeysockets/baileys');

// Bot configuration
const BOT_NAME = process.env.BOT_NAME || "RAMA-XMD";
const OWNER_NAME = process.env.OWNER_NAME || "mr presenter";
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
                { name: 'ping', category: 'utility' },
                { name: 'prefix', category: 'settings' },
                { name: 'menu', category: 'utility' },
                { name: 'help', category: 'utility' },
                { name: 'RAMA-XMD', category: 'utility' }
            ];
            
            // Build command list from loaded commands
            const folderCommands = [];
            for (const [pattern, command] of allCommands.entries()) {
                // Skip the menu command itself to avoid duplication
                if (pattern === 'menu' || pattern === 'help' || pattern === 'RAMA-XMD') continue;
                
                // Check if command has category or tags
                let category = command.category || 'general';
                if (command.tags && Array.isArray(command.tags)) {
                    category = command.tags[0] || 'general';
                }
                
                folderCommands.push({
                    name: pattern,
                    category: category
                });
            }
            
            // Combine built-in and folder commands
            const allCommandList = [...builtInCommands, ...folderCommands];
            
            // Group commands by category
            const commandsByCategory = {};
            allCommandList.forEach(cmd => {
                const cat = cmd.category || 'general';
                if (!commandsByCategory[cat]) {
                    commandsByCategory[cat] = [];
                }
                commandsByCategory[cat].push(cmd);
            });
            
            // Define emojis for categories
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
            
            // Prepare categories for carousel
            const categoriesRaw = [];
            for (const [category, cmds] of Object.entries(commandsByCategory)) {
                const emoji = categoryEmojis[category] || '🔹';
                const commandNames = cmds.map(cmd => cmd.name);
                categoriesRaw.push({
                    name: `${emoji} ${category.toUpperCase()}`,
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
    
    let menuText = `╔══════════════════════════════════════╗\n`;
    menuText += `║     🚀 ${BOT_NAME} 🚀     ║\n`;
    menuText += `╠══════════════════════════════════════╣\n`;
    menuText += `║  📌 Prefix : ${PREFIX.padEnd(20)}║\n`;
    menuText += `║  👤 Owner  : ${OWNER_NAME.padEnd(20)}║\n`;
    menuText += `║  🔧 Total  : ${allCommandList.length.toString().padEnd(20)}║\n`;
    menuText += `╠══════════════════════════════════════╣\n`;
    menuText += `║  📋 MENU LIST                       ║\n`;
    menuText += `╠══════════════════════════════════════╣\n`;
    
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
    
    return menuText;
}
