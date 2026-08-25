// plugins/aiVoice.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// State management
const state = {
    enabled: false,
    voiceType: 'female', // 'female' or 'male'
    language: 'sw', // swahili
    slow: false
};

const stateFilePath = path.join(__dirname, '../data/aiVoiceState.json');

// Load state from file
function loadState() {
    try {
        if (fs.existsSync(stateFilePath)) {
            const data = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
            Object.assign(state, data);
        }
    } catch (error) {
        console.error('Error loading AI voice state:', error);
    }
}

// Save state to file
function saveState() {
    try {
        fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('Error saving AI voice state:', error);
    }
}

// Load state on startup
loadState();

// Generate voice using TTS API
async function generateVoice(text, voiceType = 'female', language = 'sw') {
    try {
        // Try using Google TTS via API
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${language}&client=tw-ob`;
        
        const response = await axios({
            method: 'get',
            url: ttsUrl,
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const tempFile = path.join(process.cwd(), 'temp', `voice_${Date.now()}.mp3`);
        fs.writeFileSync(tempFile, response.data);
        
        return tempFile;
    } catch (error) {
        console.error('Error generating voice:', error);
        // Fallback: Try using alternative TTS
        return await generateVoiceFallback(text);
    }
}

// Fallback TTS using gTTS (if available) or another service
async function generateVoiceFallback(text) {
    try {
        // Try using local gtts if installed
        const tempFile = path.join(process.cwd(), 'temp', `voice_${Date.now()}.mp3`);
        
        // Use gTTS command line if available
        await execPromise(`gtts-cli "${text}" --output "${tempFile}"`);
        
        if (fs.existsSync(tempFile) && fs.statSync(tempFile).size > 0) {
            return tempFile;
        }
        
        throw new Error('Fallback TTS failed');
    } catch (error) {
        console.error('Fallback TTS error:', error);
        // Try using built-in TTS via say command (for Linux/Mac)
        try {
            const tempFile = path.join(process.cwd(), 'temp', `voice_${Date.now()}.mp3`);
            await execPromise(`say -o "${tempFile}.aiff" "${text}" && ffmpeg -i "${tempFile}.aiff" "${tempFile}" -y`);
            if (fs.existsSync(tempFile)) {
                return tempFile;
            }
        } catch (e) {
            console.error('Say command error:', e);
        }
        
        return null;
    }
}

// Send voice message with typing indicator
async function sendVoiceMessage(sock, chatId, text, quotedMessage = null) {
    // Show recording indicator
    await sock.sendPresenceUpdate('recording', chatId);
    
    try {
        // Generate voice
        const voiceFile = await generateVoice(text, state.voiceType, state.language);
        
        if (!voiceFile || !fs.existsSync(voiceFile)) {
            // Fallback: send text message if voice fails
            await sock.sendMessage(chatId, {
                text: `🔊 *Voice generation failed!*\n\nOriginal message: ${text}`
            }, { quoted: quotedMessage });
            return;
        }

        // Read the file and send as voice
        const voiceBuffer = fs.readFileSync(voiceFile);
        
        await sock.sendMessage(chatId, {
            audio: voiceBuffer,
            mimetype: 'audio/mpeg',
            ptt: true // This makes it a voice note
        }, { quoted: quotedMessage });

        // Clean up temp file
        try {
            fs.unlinkSync(voiceFile);
        } catch (e) {}

        // Reset presence
        await sock.sendPresenceUpdate('available', chatId);
        
    } catch (error) {
        console.error('Error sending voice message:', error);
        await sock.sendMessage(chatId, {
            text: `❌ Failed to generate voice message. Please try again later.`
        }, { quoted: quotedMessage });
    }
}

// Main command handler
async function handleAiVoiceCommand(sock, chatId, message, args) {
    try {
        // Check if sender is owner/sudo
        const isOwner = message.key.fromMe || await isSudo(message.key.participant || message.key.remoteJid);
        if (!isOwner) {
            await sock.sendMessage(chatId, {
                text: '❌ This command is only for the bot owner!'
            }, { quoted: message });
            return;
        }

        const subCommand = args[0]?.toLowerCase();

        // Show status if no arguments
        if (!subCommand) {
            await sock.sendMessage(chatId, {
                text: `🔊 *AI Voice Status*\n\n` +
                      `Status: ${state.enabled ? '✅ ON' : '❌ OFF'}\n` +
                      `Voice Type: ${state.voiceType}\n` +
                      `Language: ${state.language}\n\n` +
                      `📌 *Commands:*\n` +
                      `.aivoice on - Turn on\n` +
                      `.aivoice off - Turn off\n` +
                      `.aivoice female - Set female voice\n` +
                      `.aivoice male - Set male voice\n` +
                      `.aivoice sw - Set Swahili\n` +
                      `.aivoice en - Set English`
            }, { quoted: message });
            return;
        }

        // Handle subcommands
        switch (subCommand) {
            case 'on':
                state.enabled = true;
                saveState();
                await sock.sendMessage(chatId, {
                    text: '✅ *AI Voice is now ON*\n\nI will reply with voice messages to your messages!'
                }, { quoted: message });
                break;

            case 'off':
                state.enabled = false;
                saveState();
                await sock.sendMessage(chatId, {
                    text: '❌ *AI Voice is now OFF*\n\nI will no longer reply with voice messages.'
                }, { quoted: message });
                break;

            case 'female':
            case 'woman':
                state.voiceType = 'female';
                saveState();
                await sock.sendMessage(chatId, {
                    text: '👩 *Voice set to FEMALE*'
                }, { quoted: message });
                break;

            case 'male':
            case 'man':
                state.voiceType = 'male';
                saveState();
                await sock.sendMessage(chatId, {
                    text: '👨 *Voice set to MALE*'
                }, { quoted: message });
                break;

            case 'sw':
            case 'swahili':
                state.language = 'sw';
                saveState();
                await sock.sendMessage(chatId, {
                    text: '🇹🇿 *Language set to SWAHILI*'
                }, { quoted: message });
                break;

            case 'en':
            case 'english':
                state.language = 'en';
                saveState();
                await sock.sendMessage(chatId, {
                    text: '🇬🇧 *Language set to ENGLISH*'
                }, { quoted: message });
                break;

            default:
                await sock.sendMessage(chatId, {
                    text: `❌ Unknown option: ${subCommand}\n\n` +
                          `Available options: on, off, female, male, sw, en`
                }, { quoted: message });
        }

    } catch (error) {
        console.error('Error in AI Voice command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ An error occurred while processing the command.'
        }, { quoted: message });
    }
}

// Handle incoming messages for AI Voice
async function handleAiVoiceMessage(sock, chatId, message, userMessage, senderId) {
    // Check if AI Voice is enabled
    if (!state.enabled) return;

    // Don't reply to own messages
    if (message.key.fromMe) return;

    // Don't reply to command messages
    if (userMessage.startsWith('.')) return;

    // Don't reply to messages with links, media, etc.
    if (message.message?.imageMessage || 
        message.message?.videoMessage || 
        message.message?.stickerMessage ||
        message.message?.audioMessage ||
        message.message?.documentMessage) return;

    // Only reply to text messages
    const text = message.message?.conversation || 
                 message.message?.extendedTextMessage?.text;
    
    if (!text || text.length === 0) return;

    // Don't reply to very long messages (optional)
    if (text.length > 200) return;

    // Send voice reply
    await sendVoiceMessage(sock, chatId, text, message);
}

// Helper function to check sudo status (re-use from main)
async function isSudo(userId) {
    try {
        const sudoData = JSON.parse(fs.readFileSync('./data/sudo.json'));
        return sudoData.sudo && sudoData.sudo.includes(userId);
    } catch {
        return false;
    }
}

// Export functions
module.exports = {
    handleAiVoiceCommand,
    handleAiVoiceMessage,
    state,
    loadState,
    saveState,
    sendVoiceMessage,
    isSudo
};