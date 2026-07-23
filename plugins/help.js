// commands/help.js – Interactive category menu (box style with ✦, no footer)
const fs = require('fs');
const path = require('path');
const settings = require('../settings');

async function helpCommand(sock, chatId, message) {
    try {
        const prefix = settings.PREFIX || '.';
        const botName = settings.botName || 'RAMA-XMD-MD';
        const owner = settings.botOwner || 'Mr Unique Hacker';
        const version = settings.version || '3.0.0';

        // Load image (optional)
        const imagePath = path.join(__dirname, '../assets/bot_image.jpg');
        let imageBuffer = null;
        if (fs.existsSync(imagePath)) {
            imageBuffer = fs.readFileSync(imagePath);
        }

        // Categories with your original commands
        const categories = [
            { name: '🌐 GENERAL', number: 1, commands: [
                'help', 'menu', 'ping', 'alive', 'tts', 'owner', 'joke', 'quote',
                'fact', 'weather', 'news', 'attp', 'lyrics', '8ball', 'groupinfo',
                'staff', 'admins', 'vv', 'trt', 'ss', 'jid', 'url'
            ] },
            { name: '👮‍♂️ ADMIN', number: 2, commands: [
                'ban', 'promote', 'demote', 'mute', 'unmute', 'delete', 'del',
                'kick', 'warnings', 'warn', 'antilink', 'antibadword', 'clear',
                'tag', 'tagall', 'tagnotadmin', 'hidetag', 'chatbot', 'resetlink',
                'antitag', 'welcome', 'goodbye', 'setgdesc', 'setgname', 'setgpp'
            ] },
            { name: '🔒 OWNER', number: 3, commands: [
                'mode', 'clearsession', 'antidelete', 'cleartmp', 'update', 'settings',
                'setpp', 'autoreact', 'autostatus', 'autostatus react', 'autotyping',
                'autoread', 'anticall', 'pmblocker', 'pmblocker setmsg', 'setmention',
                'mention'
            ] },
            { name: '🎨 IMAGE/STICKER', number: 4, commands: [
                'blur', 'simage', 'sticker', 'removebg', 'remini', 'crop', 'tgsticker',
                'meme', 'take', 'emojimix', 'igs', 'igsc'
            ] },
            { name: '🖼️ PIES', number: 5, commands: [
                'pies', 'china', 'indonesia', 'japan', 'korea', 'hijab'
            ] },
            { name: '🎮 GAMES', number: 6, commands: [
                'tictactoe', 'hangman', 'guess', 'trivia', 'answer', 'truth', 'dare'
            ] },
            { name: '🤖 AI', number: 7, commands: [
                'gpt', 'gemini', 'imagine', 'flux', 'sora'
            ] },
            { name: '🎯 FUN', number: 8, commands: [
                'compliment', 'insult', 'flirt', 'shayari', 'goodnight', 'roseday',
                'character', 'wasted', 'ship', 'simp', 'stupid'
            ] },
            { name: '🔤 TEXTMAKER', number: 9, commands: [
                'metallic', 'ice', 'snow', 'impressive', 'matrix', 'light', 'neon',
                'devil', 'purple', 'thunder', 'leaves', '1917', 'arena', 'hacker',
                'sand', 'blackpink', 'glitch', 'fire'
            ] },
            { name: '📥 DOWNLOADER', number: 10, commands: [
                'play', 'song', 'spotify', 'instagram', 'facebook', 'tiktok',
                'video', 'ytmp4'
            ] },
            { name: '🧩 MISC', number: 11, commands: [
                'heart', 'horny', 'circle', 'lgbt', 'lolice', 'its-so-stupid',
                'namecard', 'oogway', 'tweet', 'ytcomment', 'comrade', 'gay',
                'glass', 'jail', 'passed', 'triggered'
            ] },
            { name: '🖼️ ANIME', number: 12, commands: [
                'nom', 'poke', 'cry', 'kiss', 'pat', 'hug', 'wink', 'facepalm'
            ] },
            { name: '💻 GITHUB', number: 13, commands: [
                'git', 'github', 'sc', 'script', 'repo'
            ] }
        ];

        // Build category list with numbers (interactive menu)
        let categoryText = `╭─⌈ 📋 *${botName}* ⌋\n│\n`;
        categoryText += `├─⊷ *Owner:* ${owner}\n`;
        categoryText += `├─⊷ *Version:* ${version}\n`;
        categoryText += `├─⊷ *Prefix:* ${prefix}\n`;
        categoryText += `│\n`;
        for (const cat of categories) {
            categoryText += `├─⊷ *${cat.number}.* ${cat.name}\n`;
        }
        categoryText += `│\n├─⊷ *Reply with a number* to see commands\n│\n╰─⊷ _Valid for 60 seconds_`;

        // Send category list with optional image
        let promptMsg;
        if (imageBuffer) {
            promptMsg = await sock.sendMessage(chatId, {
                image: imageBuffer,
                caption: categoryText
            }, { quoted: message });
        } else {
            promptMsg = await sock.sendMessage(chatId, {
                text: categoryText
            }, { quoted: message });
        }

        const promptId = promptMsg.key.id;
        const originalSender = message.key.participant || message.key.remoteJid;
        let isHandled = false;

        // Set up reply listener for category selection
        const replyHandler = async (update) => {
            try {
                if (isHandled) return;

                const msg = update.messages[0];
                if (!msg.message) return;

                const ctx = msg.message.extendedTextMessage?.contextInfo;
                if (ctx?.stanzaId !== promptId) return;

                const replyText = (msg.message.conversation ||
                                  msg.message.extendedTextMessage?.text || '').trim();
                const senderId = msg.key.participant || msg.key.remoteJid;
                if (senderId !== originalSender) return;

                // Remove listener immediately to prevent duplicate handling
                sock.ev.off("messages.upsert", replyHandler);
                isHandled = true;

                // React to the user's reply
                await sock.sendMessage(chatId, { 
                    react: { text: '📖', key: msg.key } 
                }).catch(() => {});

                const selectedNumber = parseInt(replyText);
                const selectedCat = categories.find(c => c.number === selectedNumber);

                if (!selectedCat) {
                    await sock.sendMessage(chatId, {
                        text: `❌ *Invalid number* – please send a number between 1 and ${categories.length}.`
                    }, { quoted: msg });
                    return;
                }

                // ========== BOX STYLE WITH ✦ (NO FOOTER) ==========
                let boxContent = `╔═[✦ ${selectedCat.name} ✦]═╗\n`;
                for (const cmd of selectedCat.commands) {
                    boxContent += `║✦ ↳ ${prefix}${cmd}\n`;
                }
                boxContent += `╚━━━━━━━━━━━━━━━━━━━✦`;

                await sock.sendMessage(chatId, {
                    text: boxContent
                }, { quoted: msg });

            } catch (err) {
                console.error('[helpCommand] reply error:', err);
            }
        };

        // Register event listener
        sock.ev.on("messages.upsert", replyHandler);

        // Auto-expire after 60 seconds
        setTimeout(() => {
            if (!isHandled) {
                sock.ev.off("messages.upsert", replyHandler);
                sock.sendMessage(chatId, {
                    text: '⏰ *Menu session expired*. Send `.help` or `.menu` again.'
                }).catch(() => {});
            }
        }, 60000);

    } catch (error) {
        console.error('[helpCommand] error:', error);
        await sock.sendMessage(chatId, {
            text: '❌ *Failed to load menu*. Please try again later.'
        }, { quoted: message }).catch(() => {});
    }
}

module.exports = helpCommand;