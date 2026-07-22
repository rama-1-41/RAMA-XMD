// commands/menu1.js – Dynamic carousel menu that auto-loads commands
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

async function menu1Command(sock, chatId, message, args) {
  try {
    const botName = process.env.BOT_NAME || 'RAMA-XMD';
    const prefix = process.env.PREFIX || '.';
    const owner = process.env.OWNER_NAME || '404unkown';
    const version = '3.0.7';
    const MENU_IMAGE_URL = process.env.MENU_IMAGE_URL || "https://cdn.phototourl.com/free/2026-07-22-053a959a-b3e5-4a76-93ec-afb24f5862ef.png";
    const REPO_LINK = process.env.REPO_LINK || "https://github.com";

    // Get all commands from global
    const allCommands = global.commands || new Map();
    
    // ========== BUILD CATEGORIES DYNAMICALLY ==========
    const categoriesRaw = [];
    const commandCategories = {};

    // Group commands by category
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

    // Category emojis
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

    // Sort categories alphabetically
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
          { upload: sock.waUploadToServer }
        );
        return content.imageMessage;
      } catch (error) {
        console.error('Error generating image:', error);
        return null;
      }
    }

    const menu1Image = imageBuffer ? await getImageMessage(imageBuffer) : null;

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
║✦ ↳ *TOTAL CMDS:* ${allCommands.size}
╚═══════✦═══════╝`;

    cards.push({
      header: { title: `${botName} INFO`, hasMediaAttachment: !!menu1Image, imageMessage: menu1Image },
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
          cmdList += `║✦ ↳ ${prefix}${cmd}\n`;
        });
        const title = (chunk === 0) ? `${cat.name}` : `${cat.name} (cont.)`;
        const desc = `╔═[✦ ${title} ✦]═╗\n${cmdList}╚━━━━━━━━━━━━━━━━━━━✦`;
        cardIndex++;
        cards.push({
          header: { title: `${title}`, hasMediaAttachment: !!menu1Image, imageMessage: menu1Image },
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
    const interactiveMsg = generateWAMessageFromContent(chatId, {
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

    await sock.relayMessage(chatId, interactiveMsg.message, { messageId: interactiveMsg.key.id });

  } catch (error) {
    console.error('❌ menu1 error:', error);
    await sock.sendMessage(chatId, { text: '❌ Interactive menu failed to load. Please try again.' }, { quoted: message });
  }
}

module.exports = menu1Command;