// plugins/totxt.js - Full working script with AssemblyAI & OpenAI
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Load environment variables
require('dotenv').config();

// Try to load ffmpeg-static
let ffmpegPath = 'ffmpeg';
try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic) ffmpegPath = ffmpegStatic;
} catch (e) {}

module.exports = {
    name: 'totxt',
    description: 'Convert voice notes to text using AI',
    category: 'utility',
    usage: '.totxt [lang] - Reply to a voice note',
    aliases: ['.transcribe', '.voicetotext', '.stt'],
    
    handler: async (sock, chatId, message, args) => {
        try {
            // Show typing indicator
            await sock.sendPresenceUpdate('composing', chatId);

            // Check if replying to a message
            const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            
            if (!quotedMessage) {
                await sock.sendMessage(chatId, {
                    text: `🎤 *Voice to Text Converter*

❌ Please reply to a voice note!

📌 *Usage:*
.totxt - Reply to a voice note (English)
.totxt sw - Reply to a voice note (Swahili)

🌍 *Languages:*
• en - English (default)
• sw - Swahili
• es - Spanish
• fr - French
• de - German
• it - Italian
• pt - Portuguese

💡 *Using:* AssemblyAI + OpenAI Whisper

📝 *Aliases:*
.transcribe
.voicetotext
.stt`
                }, { quoted: message });
                return;
            }

            // Check if quoted message is a voice note
            const voiceMessage = quotedMessage.audioMessage;
            if (!voiceMessage || !voiceMessage.ptt) {
                await sock.sendMessage(chatId, {
                    text: '❌ Please reply to a voice note (.ptt) message!'
                }, { quoted: message });
                return;
            }

            // Get language
            const language = args && args.length > 0 ? args[0] : 'en';
            
            const languages = {
                'en': 'English',
                'sw': 'Swahili',
                'es': 'Spanish',
                'fr': 'French',
                'de': 'German',
                'it': 'Italian',
                'pt': 'Portuguese'
            };

            if (!languages[language]) {
                await sock.sendMessage(chatId, {
                    text: `❌ Unsupported language: ${language}\n\nSupported: ${Object.keys(languages).join(', ')}`
                }, { quoted: message });
                return;
            }

            // Send processing message
            const processingMsg = await sock.sendMessage(chatId, {
                text: `🎤 *Processing Voice Note...*\n\n⏳ Downloading and converting...\n🌍 Language: ${languages[language]}\n📏 Duration: ${voiceMessage.seconds || 'Unknown'} seconds`
            }, { quoted: message });

            // ===== DOWNLOAD MEDIA =====
            let mediaBuffer = null;
            let mediaPath = null;

            try {
                // Try different download methods
                if (sock.downloadMediaMessage) {
                    mediaBuffer = await sock.downloadMediaMessage({
                        message: { audioMessage: voiceMessage }
                    });
                } else if (sock.decryptMedia) {
                    const mediaData = await sock.decryptMedia(voiceMessage);
                    mediaBuffer = Buffer.from(mediaData);
                } else if (sock.downloadAndSaveMediaMessage) {
                    mediaPath = await sock.downloadAndSaveMediaMessage({
                        message: { audioMessage: voiceMessage }
                    }, path.join(process.cwd(), 'temp', `voice_${Date.now()}.mp3`));
                } else if (voiceMessage.url) {
                    const response = await axios({
                        method: 'get',
                        url: voiceMessage.url,
                        responseType: 'arraybuffer'
                    });
                    mediaBuffer = Buffer.from(response.data);
                } else if (voiceMessage._buffer) {
                    mediaBuffer = voiceMessage._buffer;
                } else {
                    throw new Error('Cannot download media - no compatible method found');
                }
            } catch (downloadError) {
                console.error('Download error:', downloadError);
                throw new Error('Failed to download voice note');
            }

            // If we have a path but no buffer, read the file
            if (mediaPath && !mediaBuffer) {
                mediaBuffer = fs.readFileSync(mediaPath);
            }

            if (!mediaBuffer) {
                await sock.sendMessage(chatId, {
                    text: '❌ Failed to download voice note. Please try again.'
                });
                return;
            }

            // Save buffer to temp file
            const tempDir = path.join(process.cwd(), 'temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            
            const tempAudioPath = path.join(tempDir, `voice_${Date.now()}.mp3`);
            fs.writeFileSync(tempAudioPath, mediaBuffer);

            // Convert audio format
            let audioPath = tempAudioPath;
            const convertedPath = path.join(tempDir, `converted_${Date.now()}.mp3`);
            
            try {
                await execPromise(`"${ffmpegPath}" -i "${tempAudioPath}" -ar 16000 -ac 1 -acodec libmp3lame "${convertedPath}" -y`);
                audioPath = convertedPath;
            } catch (e) {
                console.error('FFmpeg conversion error:', e);
                try {
                    await execPromise(`"${ffmpegPath}" -i "${tempAudioPath}" -ar 16000 -ac 1 "${convertedPath}" -y`);
                    audioPath = convertedPath;
                } catch (e2) {
                    console.error('Fallback conversion error:', e2);
                }
            }

            // Update processing message
            await sock.sendMessage(chatId, {
                text: `🎤 *Processing Voice Note...*\n\n⏳ Transcribing with AI...\n🌍 Language: ${languages[language]}`
            }, { quoted: message });

            // ===== TRANSCRIBE USING APIS =====
            let transcription = null;
            let methodUsed = '';

            // ============================================
            // METHOD 1: ASSEMBLYAI API
            // ============================================
            try {
                console.log('🎯 Trying AssemblyAI...');
                transcription = await transcribeWithAssemblyAI(audioPath);
                if (transcription) {
                    methodUsed = 'AssemblyAI 🎙️';
                    console.log('✅ AssemblyAI succeeded!');
                }
            } catch (e) {
                console.log('❌ AssemblyAI failed:', e.message);
            }

            // ============================================
            // METHOD 2: OPENAI WHISPER API (Fallback)
            // ============================================
            if (!transcription) {
                try {
                    console.log('🎯 Trying OpenAI Whisper...');
                    transcription = await transcribeWithOpenAI(audioPath, language);
                    if (transcription) {
                        methodUsed = 'OpenAI Whisper 🤖';
                        console.log('✅ OpenAI Whisper succeeded!');
                    }
                } catch (e) {
                    console.log('❌ OpenAI Whisper failed:', e.message);
                }
            }

            // ============================================
            // METHOD 3: HUGGING FACE FREE API (Last resort)
            // ============================================
            if (!transcription) {
                try {
                    console.log('🎯 Trying Hugging Face...');
                    transcription = await transcribeWithHuggingFace(audioPath);
                    if (transcription) {
                        methodUsed = 'Hugging Face Free 🔓';
                        console.log('✅ Hugging Face succeeded!');
                    }
                } catch (e) {
                    console.log('❌ Hugging Face failed:', e.message);
                }
            }

            // Clean up temp files
            try {
                if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
                if (fs.existsSync(convertedPath) && convertedPath !== tempAudioPath) fs.unlinkSync(convertedPath);
                if (mediaPath && fs.existsSync(mediaPath) && mediaPath !== tempAudioPath) fs.unlinkSync(mediaPath);
            } catch (e) {}

            // Delete processing message
            try {
                await sock.sendMessage(chatId, { delete: processingMsg.key });
            } catch (e) {}

            // Send result
            if (transcription && transcription.trim().length > 0) {
                const response = `🎤 *Voice to Text Conversion*

📝 *Transcription:*
${transcription}

🌍 *Language:* ${languages[language]}
🔧 *Method:* ${methodUsed}
⏱️ *Duration:* ${voiceMessage.seconds || 'Unknown'}s
💰 *Cost:* Free (using your API credits)`;

                await sock.sendMessage(chatId, {
                    text: response
                }, { quoted: message });

                // Send long transcriptions as file
                if (transcription.length > 1000) {
                    await sock.sendMessage(chatId, {
                        document: Buffer.from(transcription, 'utf-8'),
                        mimetype: 'text/plain',
                        fileName: `transcription_${Date.now()}.txt`,
                        caption: '📄 *Full Transcription*'
                    }, { quoted: message });
                }

                await sock.sendMessage(chatId, { 
                    react: { text: '✅', key: message.key } 
                }).catch(() => {});

            } else {
                await sock.sendMessage(chatId, {
                    text: `❌ *Transcription Failed*

All transcription methods failed. Please check:

1. Your API keys in .env file
2. Internet connection
3. Voice note clarity

💡 *Try:*
• Use a shorter voice note
• Speak clearly
• Try again later

📋 *Your .env should have:*
ASSEMBLYAI_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here`
                }, { quoted: message });
            }

            await sock.sendPresenceUpdate('available', chatId);

        } catch (error) {
            console.error('Error in totxt command:', error);
            await sock.sendMessage(chatId, {
                text: `❌ *Error Processing Voice Note!*

${error.message || 'Unknown error'}

💡 *Troubleshooting:*
• Make sure FFmpeg is installed
• Check your API keys in .env
• Try a shorter voice note`
            }, { quoted: message });
        }
    }
};

// ─── ASSEMBLYAI API ──────────────────────────────────────────

async function transcribeWithAssemblyAI(audioPath) {
    try {
        const apiKey = process.env.ASSEMBLYAI_API_KEY;
        if (!apiKey) {
            throw new Error('ASSEMBLYAI_API_KEY not found in .env');
        }

        console.log('📤 Uploading to AssemblyAI...');
        
        // Upload audio
        const audioBuffer = fs.readFileSync(audioPath);
        const uploadResponse = await axios({
            method: 'post',
            url: 'https://api.assemblyai.com/v2/upload',
            data: audioBuffer,
            headers: {
                'Authorization': apiKey,
                'Content-Type': 'application/octet-stream'
            },
            timeout: 60000
        });

        const audioUrl = uploadResponse.data.upload_url;
        console.log('✅ Uploaded successfully');

        // Start transcription
        console.log('🎯 Starting transcription...');
        const transcriptResponse = await axios({
            method: 'post',
            url: 'https://api.assemblyai.com/v2/transcript',
            data: {
                audio_url: audioUrl,
                language_code: 'sw',
                punctuate: true,
                format_text: true,
                speaker_labels: false
            },
            headers: {
                'Authorization': apiKey,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        const transcriptId = transcriptResponse.data.id;

        // Poll for result
        let result = null;
        for (let i = 0; i < 60; i++) { // Wait up to 60 seconds
            await new Promise(r => setTimeout(r, 1000));
            
            const statusResponse = await axios({
                method: 'get',
                url: `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
                headers: {
                    'Authorization': apiKey
                },
                timeout: 30000
            });

            if (statusResponse.data.status === 'completed') {
                result = statusResponse.data.text;
                console.log('✅ Transcription completed!');
                break;
            } else if (statusResponse.data.status === 'error') {
                throw new Error(statusResponse.data.error || 'AssemblyAI error');
            }
        }

        return result;
    } catch (error) {
        console.error('AssemblyAI error:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
        return null;
    }
}

// ─── OPENAI WHISPER API ──────────────────────────────────────────

async function transcribeWithOpenAI(audioPath, language) {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY not found in .env');
        }

        console.log('🎯 Sending to OpenAI Whisper...');

        const formData = new FormData();
        formData.append('file', fs.createReadStream(audioPath));
        formData.append('model', 'whisper-1');
        formData.append('language', language === 'sw' ? 'sw' : language);
        formData.append('response_format', 'text');

        const response = await axios({
            method: 'post',
            url: 'https://api.openai.com/v1/audio/transcriptions',
            data: formData,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                ...formData.getHeaders()
            },
            timeout: 60000
        });

        console.log('✅ OpenAI Whisper succeeded!');
        return response.data.text || response.data;
    } catch (error) {
        console.error('OpenAI error:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
        return null;
    }
}

// ─── HUGGING FACE FREE API (No key needed) ──────────────────────────

async function transcribeWithHuggingFace(audioPath) {
    try {
        console.log('🎯 Trying Hugging Face free API...');

        const audioBuffer = fs.readFileSync(audioPath);
        const formData = new FormData();
        formData.append('audio', audioBuffer, { filename: 'audio.mp3' });

        // Use free Whisper model
        const response = await axios({
            method: 'post',
            url: 'https://api-inference.huggingface.co/models/openai/whisper-small',
            data: formData,
            headers: {
                ...formData.getHeaders()
            },
            timeout: 60000
        });

        if (response.data && response.data.text) {
            console.log('✅ Hugging Face succeeded!');
            return response.data.text;
        }
        return null;
    } catch (error) {
        console.error('Hugging Face error:', error.message);
        return null;
    }
}