// commands/menu.js – Square cards, long categories split into multiple cards
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const {
  generateWAMessageContent,
  generateWAMessageFromContent
} = require('@whiskeysockets/baileys');

function runtime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours}h ${minutes}m ${secs}s`;
}

async function menuCommand(conn, message, m, options) {
  try {
    const { from } = options;
    const botName = process.env.BOT_NAME || 'RAMA-XMD';
    const prefix = process.env.PREFIX || '.';
    const owner = process.env.OWNER_NAME || '404unkown';
    const version = '3.0.7';
    const MENU_IMAGE_URL = process.env.MENU_IMAGE_URL || "https://cdn.phototourl.com/free/2026-07-22-053a959a-b3e5-4a76-93ec-afb24f5862ef.png";
    const REPO_LINK = process.env.REPO_LINK || "https://github.com";

    // Get all commands from global
    const allCommands = global.commands || new Map();

    // ========== CATEGORIZED COMMANDS ==========
    const categoriesRaw = [];

    // Build categories from loaded commands
    const commandCategories = {};
    for (const [pattern, command] of allCommands.entries()) {
      let category = command.category || 'general';
      if (command.tags && Array.isArray(command.tags)) {
        category = command.tags[0] || 'general';
      }
      if (!commandCategories[category]) {
        commandCategories[category] = [];
      }
      commandCategories[category].push(pattern);
    }

    // Define category names with emojis
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

    // Convert to categoriesRaw format
    for (const [category, cmds] of Object.entries(commandCategories)) {
      const emoji = categoryEmojis[category] || '🔹';
      categoriesRaw.push({
        name: `${emoji} ${category.toUpperCase()}`,
        commands: cmds
      });
    }

    // Sort categories
    categoriesRaw.sort((a, b) => a.name.localeCompare(b.name));

    // ========== GET IMAGE FROM URL ==========
    let imageBuffer = null;
    try {
      const response = await axios.get(MENU_IMAGE_URL, { 
        responseType: 'arraybuffer', 
        timeout: 10000 
      });
      imageBuffer = Buffer.from(response.data);
      console.log('📸 Menu image loaded from URL');
    } catch (error) {
      console.log('📸 Failed to load image from URL');
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
        console.error('Error generating image:', error);
        return null;
      }
    }

    const menuImage = imageBuffer ? await getImageMessage(imageBuffer) : null;

    // ========== BUILD CARDS ==========
    const CHUNK_SIZE = 12;
    const cards = [];

    // First card: Bot info
    const infoDesc = `╔══[✦${botName}✦]══╗
║✦ ↳ *NAME:* 🔥${botName}🔥
║✦ ↳ *RUNTIME:* ${runtime(process.uptime())}
║✦ ↳ *VERSION:* v${version}
║✦ ↳ *OWNER:* 🧩${owner}🧩
║✦ ↳ *PREFIX:* ${prefix}
╚═══════✦═══════╝`;

    cards.push({
      header: { 
        title: `${botName} INFO`, 
        hasMediaAttachment: !!menuImage, 
        imageMessage: menuImage 
      },
      body: { text: infoDesc },
      footer: { text: 'Page 1' },
      nativeFlowMessage: {
        buttons: [
          { 
            name: "cta_url", 
            buttonParamsJson: JSON.stringify({ 
              display_text: "📢 CHANNEL", 
              url: "https://whatsapp.com/channel/0029Vb5ytZEE50UbwV7xBv1k" 
            }) 
          },
          { 
            name: "cta_url", 
            buttonParamsJson: JSON.stringify({ 
              display_text: "🔗 REPO", 
              url: REPO_LINK 
            }) 
          }
        ]
      }
    });

    // Process each category
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
          cmdList += `║✦ ↳ ${prefix}${cmd}\n`;
        });
        const title = (chunk === 0) ? `${cat.name}` : `${cat.name} (cont.)`;
        const desc = `╔═[✦ ${title} ✦]═╗\n${cmdList}╚━━━━━━━━━━━━━━━━━━━✦`;
        cardIndex++;
        cards.push({
          header: { 
            title: `${title}`, 
            hasMediaAttachment: !!menuImage, 
            imageMessage: menuImage 
          },
          body: { text: desc },
          footer: { text: `Page ${cardIndex}` },
          nativeFlowMessage: {
            buttons: [
              { 
                name: "cta_url", 
                buttonParamsJson: JSON.stringify({ 
                  display_text: "📢 CHANNEL", 
                  url: "https://whatsapp.com/channel/0029Vb5ytZEE50UbwV7xBv1k" 
                }) 
              },
              { 
                name: "cta_url", 
                buttonParamsJson: JSON.stringify({ 
                  display_text: "🔗 REPO", 
                  url: REPO_LINK 
                }) 
              }
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
            body: { text: `✨ ${botName} ✨` },
            footer: { text: `CYBER DARK BOT` },
            carouselMessage: { cards }
          }
        }
      }
    }, { quoted: message });

    await conn.relayMessage(from, interactiveMsg.message, { messageId: interactiveMsg.key.id });

  } catch (error) {
    console.error('❌ Carousel menu error:', error);
    // Fallback to simple text menu if carousel fails
    const fallbackMenu = generateFallbackMenu();
    await conn.sendMessage(options.from, {
      text: fallbackMenu,
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
          body: `${process.env.BOT_NAME || 'RAMA-XMD'} - All Available Commands`,
          thumbnailUrl: process.env.MENU_IMAGE_URL || "https://cdn.phototourl.com/free/2026-07-22-053a959a-b3e5-4a76-93ec-afb24f5862ef.png",
          sourceUrl: process.env.REPO_LINK || "https://github.com",
          mediaType: 1,
          renderLargerThumbnail: true
        }
      }
    }, { quoted: message });
  }
}

// Fallback text menu
function generateFallbackMenu() {
  const allCommands = global.commands || new Map();
  const BOT_NAME = process.env.BOT_NAME || "RAMA-XMD";
  const OWNER_NAME = process.env.OWNER_NAME || "404unkown";
  const PREFIX = process.env.PREFIX || ".";

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

  return menuText;
}

module.exports = {
  pattern: 'menu',
  alias: ['help', 'RAMA-XMD'],
  category: 'utility',
  desc: 'Show interactive bot command menu',
  execute: menuCommand
};