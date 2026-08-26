// plugins/totxt.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const FormData = require('form-data');

module.exports = {
    name: 'totxt',
    description: 'Convert voice notes to text (transcription)',
    category: 'utility',
    usage: '.totxt [lang] - Reply to a voice note',
    aliases: ['.transcribe', '.voicetotext', '.speechtotext', '.stt'],
    
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
.totxt [language] - Reply to a voice note

🌍 *Languages:*
• en - English (default)
• sw - Swahili
• es - Spanish
• fr - French
• de - German
• it - Italian
• pt - Portuguese
• ru - Russian
• ja - Japanese
• zh - Chinese
• ar - Arabic
• hi - Hindi

📝 *Example:*
.totxt en - Transcribe to English
.totxt sw - Transcribe to Swahili

⏳ *Note:* Processing may take a few seconds.`
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

            // Get language from args or default to English
            const language = args && args.length > 0 ? args[0] : 'en';
            
            // Supported languages
            const languages = {
                'en': 'English',
                'sw': 'Swahili',
                'es': 'Spanish',
                'fr': 'French',
                'de': 'German',
                'it': 'Italian',
                'pt': 'Portuguese',
                'ru': 'Russian',
                'ja': 'Japanese',
                'zh': 'Chinese',
                'ar': 'Arabic',
                'hi': 'Hindi'
            };

            if (!languages[language]) {
                await sock.sendMessage(chatId, {
                    text: `❌ Unsupported language: ${language}\n\nSupported: ${Object.keys(languages).join(', ')}`
                }, { quoted: message });
                return;
            }

            // Send processing message
            const processingMsg = await sock.sendMessage(chatId, {
                text: `🎤 *Processing Voice Note...*\n\n⏳ Converting to text...\n🌍 Language: ${languages[language]}\n📏 Duration: ${voiceMessage.seconds || 'Unknown'} seconds`
            }, { quoted: message });

            // Get voice note media
            const mediaPath = await sock.downloadMediaMessage({ message: { audioMessage: voiceMessage } });
            
            if (!mediaPath) {
                await sock.sendMessage(chatId, {
                    text: '❌ Failed to download voice note. Please try again.'
                });
                return;
            }

            // Convert to proper audio format if needed
            let audioPath = mediaPath;
            const ext = path.extname(mediaPath).toLowerCase();
            
            if (ext !== '.mp3' && ext !== '.wav' && ext !== '.ogg') {
                const convertedPath = path.join(process.cwd(), 'temp', `audio_${Date.now()}.mp3`);
                try {
                    await execPromise(`ffmpeg -i "${mediaPath}" -acodec libmp3lame -ar 16000 -ac 1 "${convertedPath}" -y`);
                    audioPath = convertedPath;
                } catch (e) {
                    console.error('FFmpeg conversion error:', e);
                    // Try alternative conversion
                    try {
                        await execPromise(`ffmpeg -i "${mediaPath}" -ar 16000 -ac 1 "${convertedPath}" -y`);
                        audioPath = convertedPath;
                    } catch (e2) {
                        console.error('Fallback conversion error:', e2);
                    }
                }
            }

            // Try multiple transcription methods
            let transcription = null;
            let methodUsed = '';

            // Method 1: Google Speech-to-Text API (if API key available)
            try {
                transcription = await transcribeWithGoogle(audioPath, language);
                if (transcription) {
                    methodUsed = 'Google Speech API';
                }
            } catch (e) {
                console.log('Google API failed, trying next method...');
            }

            // Method 2: OpenAI Whisper API (if API key available)
            if (!transcription) {
                try {
                    transcription = await transcribeWithWhisper(audioPath, language);
                    if (transcription) {
                        methodUsed = 'OpenAI Whisper';
                    }
                } catch (e) {
                    console.log('Whisper API failed, trying next method...');
                }
            }

            // Method 3: Local Vosk (if installed)
            if (!transcription) {
                try {
                    transcription = await transcribeWithVosk(audioPath, language);
                    if (transcription) {
                        methodUsed = 'Vosk Offline';
                    }
                } catch (e) {
                    console.log('Vosk failed, trying next method...');
                }
            }

            // Method 4: Free Speech-to-Text API (fallback)
            if (!transcription) {
                try {
                    transcription = await transcribeWithFreeAPI(audioPath, language);
                    if (transcription) {
                        methodUsed = 'Free API';
                    }
                } catch (e) {
                    console.log('Free API failed, trying next method...');
                }
            }

            // Method 5: Local whisper.cpp (if available)
            if (!transcription) {
                try {
                    transcription = await transcribeWithWhisperCpp(audioPath, language);
                    if (transcription) {
                        methodUsed = 'Whisper.cpp';
                    }
                } catch (e) {
                    console.log('Whisper.cpp failed...');
                }
            }

            // Clean up temporary files
            try {
                if (mediaPath && fs.existsSync(mediaPath)) fs.unlinkSync(mediaPath);
                if (audioPath && audioPath !== mediaPath && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
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
⏱️ *Duration:* ${voiceMessage.seconds || 'Unknown'} seconds

${transcription.length > 100 ? '📌 *Note:* Only first 1000 characters shown' : ''}`;

                // Send as text
                await sock.sendMessage(chatId, {
                    text: response
                }, { quoted: message });

                // Also send as document for long transcriptions
                if (transcription.length > 1000) {
                    const txtBuffer = Buffer.from(transcription, 'utf-8');
                    await sock.sendMessage(chatId, {
                        document: txtBuffer,
                        mimetype: 'text/plain',
                        fileName: `transcription_${Date.now()}.txt`,
                        caption: '📄 *Full Transcription* (Download to read all)'
                    }, { quoted: message });
                }

                // Add reaction
                await sock.sendMessage(chatId, { 
                    react: { text: '✅', key: message.key } 
                }).catch(() => {});

            } else {
                await sock.sendMessage(chatId, {
                    text: `❌ *Transcription Failed*

Could not transcribe the voice note. Please try:

1. Ensure the voice note is clear
2. Try a different language
3. Try again with a shorter voice note

💡 *Tips:*
• Use clear pronunciation
• Reduce background noise
• Keep voice notes under 60 seconds for better results

If the issue persists, try using the .totxt command again.`
                }, { quoted: message });
            }

            // Reset presence
            await sock.sendPresenceUpdate('available', chatId);

        } catch (error) {
            console.error('Error in totxt command:', error);
            await sock.sendMessage(chatId, {
                text: `❌ *Error Processing Voice Note!*

${error.message || 'Unknown error'}

Please try again or use a different language.`
            }, { quoted: message });
        }
    }
};

// ─── TRANSCRIPTION METHODS ──────────────────────────────────────────

// Method 1: Google Speech-to-Text API
async function transcribeWithGoogle(audioPath, language) {
    try {
        const apiKey = process.env.GOOGLE_SPEECH_API_KEY;
        if (!apiKey) throw new Error('No Google API key');

        const audioBuffer = fs.readFileSync(audioPath);
        const audioBase64 = audioBuffer.toString('base64');

        const response = await axios({
            method: 'post',
            url: `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`,
            data: {
                config: {
                    encoding: 'MP3',
                    sampleRateHertz: 16000,
                    languageCode: language === 'sw' ? 'sw-KE' : language === 'en' ? 'en-US' : `${language}-${language.toUpperCase()}`,
                    enableAutomaticPunctuation: true,
                    model: 'default',
                    useEnhanced: true
                },
                audio: {
                    content: audioBase64
                }
            }
        });

        if (response.data.results && response.data.results.length > 0) {
            return response.data.results[0].alternatives[0].transcript;
        }
        return null;
    } catch (error) {
        console.error('Google API error:', error.message);
        return null;
    }
}

// Method 2: OpenAI Whisper API
async function transcribeWithWhisper(audioPath, language) {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error('No OpenAI API key');

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
            }
        });

        return response.data.text || response.data;
    } catch (error) {
        console.error('Whisper API error:', error.message);
        return null;
    }
}

// Method 3: Free Speech-to-Text API (Hugging Face or similar)
async function transcribeWithFreeAPI(audioPath, language) {
    try {
        // Try using Hugging Face's free inference API
        const audioBuffer = fs.readFileSync(audioPath);
        const formData = new FormData();
        formData.append('audio', audioBuffer, { filename: 'audio.mp3' });

        // Use a free model from Hugging Face
        const response = await axios({
            method: 'post',
            url: 'https://api-inference.huggingface.co/models/openai/whisper-small',
            data: formData,
            headers: {
                ...formData.getHeaders()
            },
            timeout: 30000
        });

        if (response.data && response.data.text) {
            return response.data.text;
        }
        return null;
    } catch (error) {
        console.error('Free API error:', error.message);
        return null;
    }
}

// Method 4: Vosk Offline Speech Recognition
async function transcribeWithVosk(audioPath, language) {
    try {
        // Check if vosk is installed
        const vosk = require('vosk');
        const modelPath = path.join(process.cwd(), 'models', `vosk-model-${language === 'sw' ? 'sw' : 'en'}-small`);
        
        if (!fs.existsSync(modelPath)) {
            throw new Error('Vosk model not found');
        }

        const model = new vosk.Model(modelPath);
        const rec = new vosk.Recognizer({ model: model, sampleRate: 16000 });

        // Read audio file
        const audioBuffer = fs.readFileSync(audioPath);
        
        // Convert to proper format for Vosk
        const pcmPath = path.join(process.cwd(), 'temp', `pcm_${Date.now()}.pcm`);
        await execPromise(`ffmpeg -i "${audioPath}" -acodec pcm_s16le -ar 16000 -ac 1 "${pcmPath}" -y`);
        
        const pcmBuffer = fs.readFileSync(pcmPath);
        const result = rec.acceptWaveform(pcmBuffer);
        
        fs.unlinkSync(pcmPath);
        
        if (result) {
            const text = rec.result().text;
            return text || null;
        }
        return null;
    } catch (error) {
        console.error('Vosk error:', error.message);
        return null;
    }
}

// Method 5: Whisper.cpp Local
async function transcribeWithWhisperCpp(audioPath, language) {
    try {
        const whisperPath = path.join(process.cwd(), 'whisper', 'main');
        const modelPath = path.join(process.cwd(), 'whisper', `ggml-${language === 'sw' ? 'small' : 'base'}.bin`);
        
        if (!fs.existsSync(whisperPath) || !fs.existsSync(modelPath)) {
            throw new Error('Whisper.cpp not installed');
        }

        const outputPath = path.join(process.cwd(), 'temp', `whisper_${Date.now()}.txt`);
        
        await execPromise(`"${whisperPath}" -m "${modelPath}" -f "${audioPath}" --language ${language} --output-txt --output-file "${outputPath}"`);
        
        if (fs.existsSync(outputPath)) {
            const text = fs.readFileSync(outputPath, 'utf-8');
            fs.unlinkSync(outputPath);
            return text.trim();
        }
        return null;
    } catch (error) {
        console.error('Whisper.cpp error:', error.message);
        return null;
    }
}