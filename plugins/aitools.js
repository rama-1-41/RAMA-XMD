// plugins/aitools.js - RAMA-XMD Version
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');
const mime = require('mime-types');
const settings = require('../settings');

// ─── HELPERS ──────────────────────────────────────────────────
function getMediaType(quoted) {
    if (quoted.imageMessage) return "image";
    if (quoted.videoMessage) return "video";
    if (quoted.stickerMessage) return "sticker";
    if (quoted.audioMessage) return "audio";
    if (quoted.documentMessage) return "document";
    return "unknown";
}

async function saveMediaToTemp(client, mediaNode, type) {
    const tmpDir = path.join(__dirname, "..", "temp");
    await fs.ensureDir(tmpDir);
    const fileName = `${type}-${Date.now()}`;
    const filePath = path.join(tmpDir, fileName);
    const savedPath = await client.downloadAndSaveMediaMessage(mediaNode, filePath);
    return savedPath;
}

async function uploadToUguu(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("File does not exist");

    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    const form = new FormData();
    form.append('files[]', fs.createReadStream(filePath), {
        filename: path.basename(filePath),
        contentType: mimeType
    });

    const response = await axios.post('https://uguu.se/api/upload', form, {
        headers: {
            ...form.getHeaders(),
            'origin': 'https://uguu.se',
            'referer': 'https://uguu.se/',
            'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        }
    });

    const result = response.data;
    if (result.success && result.files?.[0]?.url) {
        return result.files[0].url;
    } else {
        throw new Error("Uguu upload failed or malformed response");
    }
}

// ─── CHANNEL INFO ─────────────────────────────────────────────
function getChannelInfo(userId) {
    const userSettings = settings.getUserSettings(userId || 'default');
    return {
        contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: userSettings.newsletterJid || '120363428121144787@newsletter',
                newsletterName: userSettings.botName || 'RAMA-XMD MD',
                serverMessageId: -1
            }
        }
    };
}

// ─── COMMAND: SORA ────────────────────────────────────────────
module.exports = {
    'sora': {
        pattern: 'sora',
        aliases: ['text2video', 't2v'],
        category: 'AI',
        description: 'Generate video from text using Sora API',
        usage: '.sora <text>',
        handler: async (sock, message, args, userId) => {
            const chatId = message.key.remoteJid;
            const text = args.join(' ') || '';
            
            if (!text) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Provide a query, e.g. .sora monkey running'
                });
            }

            try {
                const apiUrl = `https://api.sora.com/generate?q=${encodeURIComponent(text)}`;
                const response = await axios.get(apiUrl, { timeout: 120000 });
                const result = response.data?.results;

                if (!result) {
                    return await sock.sendMessage(chatId, {
                        text: '❌ No video result found.'
                    });
                }

                await sock.sendMessage(chatId, {
                    video: { url: result },
                    mimetype: 'video/mp4',
                    caption: `🎥 *Sora Video*\n📝 ${text}`,
                    ...getChannelInfo(userId)
                }, { quoted: message });

            } catch (error) {
                console.error('Sora error:', error);
                await sock.sendMessage(chatId, {
                    text: '❌ Failed to fetch Sora video: ' + error.message
                });
            }
        }
    },

    // ─── COMMAND: FLUX ──────────────────────────────────────────
    'flux': {
        pattern: 'flux',
        aliases: ['fluxai', 'imageai'],
        category: 'AI',
        description: 'Generate an image using Flux API',
        usage: '.flux <text>',
        handler: async (sock, message, args, userId) => {
            const chatId = message.key.remoteJid;
            const text = args.join(' ') || '';

            if (!text) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Provide a query, e.g. .flux dog'
                });
            }

            try {
                const apiUrl = `https://api.flux.ai/generate?q=${encodeURIComponent(text)}`;
                const res = await axios.get(apiUrl, {
                    responseType: 'arraybuffer'
                });

                const filePath = './temp/flux_img.jpg';
                await fs.ensureDir('./temp');
                fs.writeFileSync(filePath, res.data);

                await sock.sendMessage(chatId, {
                    image: { url: filePath },
                    caption: `🎨 *Flux Image*\n📝 ${text}`,
                    ...getChannelInfo(userId)
                }, { quoted: message });

                fs.unlinkSync(filePath);

            } catch (err) {
                console.error('Flux error:', err);
                await sock.sendMessage(chatId, {
                    text: '❌ Failed to fetch Flux image: ' + err.message
                });
            }
        }
    },

    // ─── COMMAND: SPEECHWRITER ──────────────────────────────────
    'speechwriter': {
        pattern: 'speechwriter',
        aliases: ['speech', 'writer'],
        category: 'AI',
        description: 'Generate a speech using Speechwriter API',
        usage: '.speechwriter <topic>',
        handler: async (sock, message, args, userId) => {
            const chatId = message.key.remoteJid;
            const text = args.join(' ') || '';

            if (!text) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Provide a topic, e.g. .speechwriter how to pass exam'
                });
            }

            try {
                const url = `https://api.speechwriter.com/generate?q=${encodeURIComponent(text)}&length=short&type=dedication&tone=serious`;
                const res = await axios.get(url);

                if (!res.data?.status || !res.data?.result?.data?.data?.speech) {
                    return await sock.sendMessage(chatId, {
                        text: '❌ Speechwriter API returned an invalid response.'
                    });
                }

                const speech = res.data.result.data.data.speech;
                await sock.sendMessage(chatId, {
                    text: `📝 *Speech*\n\n${speech}`,
                    ...getChannelInfo(userId)
                }, { quoted: message });

            } catch (err) {
                console.error('Speechwriter error:', err);
                await sock.sendMessage(chatId, {
                    text: '❌ Failed to fetch speech: ' + err.message
                });
            }
        }
    },

    // ─── COMMAND: MUSLIMAI ──────────────────────────────────────
    'muslimai': {
        pattern: 'muslimai',
        aliases: ['muslim', 'quranai'],
        category: 'AI',
        description: 'Query MuslimAI API for Qur\'anic references',
        usage: '.muslimai <query>',
        handler: async (sock, message, args, userId) => {
            const chatId = message.key.remoteJid;
            const text = args.join(' ') || '';

            if (!text) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Provide a query, e.g. .muslimai who is Allah'
                });
            }

            try {
                const res = await axios.get(`https://api.muslimai.com/query?q=${encodeURIComponent(text)}`);

                if (!res.data?.status || !res.data?.result) {
                    return await sock.sendMessage(chatId, {
                        text: '❌ MuslimAI API returned an invalid response.'
                    });
                }

                const results = res.data.result.results;
                if (!results || results.length === 0) {
                    return await sock.sendMessage(chatId, {
                        text: 'ℹ️ No relevant verses found.'
                    });
                }

                let output = `📖 *MuslimAI Results*\n\n`;
                results.slice(0, 3).forEach((r, i) => {
                    output += `*${i + 1}. Surah ${r.surah_title}*\n${r.content.trim()}\n🔗 ${r.surah_url}\n\n`;
                });

                await sock.sendMessage(chatId, {
                    text: output.trim(),
                    ...getChannelInfo(userId)
                }, { quoted: message });

            } catch (err) {
                console.error('MuslimAI error:', err);
                await sock.sendMessage(chatId, {
                    text: '❌ Failed to fetch MuslimAI response: ' + err.message
                });
            }
        }
    },

    // ─── COMMAND: WORMGPT ──────────────────────────────────────
    'wormgpt': {
        pattern: 'wormgpt',
        aliases: ['wgpt', 'evilgpt'],
        category: 'AI',
        description: 'Interact with WormGPT API',
        usage: '.wormgpt <query>',
        handler: async (sock, message, args, userId) => {
            const chatId = message.key.remoteJid;
            const text = args.join(' ') || '';

            if (!text) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Provide a query, e.g. .wormgpt hi'
                });
            }

            try {
                const res = await axios.get(`https://api.wormgpt.com/chat?q=${encodeURIComponent(text)}`);

                if (!res.data?.status) {
                    return await sock.sendMessage(chatId, {
                        text: '❌ WormGPT API returned an invalid response.'
                    });
                }

                const output = res.data.result;
                await sock.sendMessage(chatId, {
                    text: `🧠 *WormGPT*\n\n${output}`,
                    ...getChannelInfo(userId)
                }, { quoted: message });

            } catch (err) {
                console.error('WormGPT error:', err);
                await sock.sendMessage(chatId, {
                    text: '❌ Failed to fetch WormGPT response: ' + err.message
                });
            }
        }
    },

    // ─── COMMAND: BIBLEAI ──────────────────────────────────────
    'bibleai': {
        pattern: 'bibleai',
        aliases: ['aibible', 'scripture'],
        category: 'AI',
        description: 'Ask Bible-based questions and get answers with references',
        usage: '.bibleai <question>',
        handler: async (sock, message, args, userId) => {
            const chatId = message.key.remoteJid;
            const text = args.join(' ') || '';

            if (!text) {
                return await sock.sendMessage(chatId, {
                    text: '📖 Ask a Bible question.\n\nExample: .bibleai what is faith'
                });
            }

            try {
                const res = await axios.get(`https://api.bibleai.com/query?q=${encodeURIComponent(text)}`);
                const data = res.data;

                if (!data.status || !data.result?.results?.data?.answer) {
                    return await sock.sendMessage(chatId, {
                        text: '❌ No Bible answer found.'
                    });
                }

                const answer = data.result.results.data.answer;
                const sources = data.result.results.data.sources;

                let caption = `📖 *${text}*\n\n${answer}\n\n📌 *Sources:* Reply with a number to view\n`;
                sources.slice(0, 5).forEach((src, i) => {
                    if (src.type === 'verse') caption += `${i + 1}. 📜 ${src.text}\n`;
                    if (src.type === 'article') caption += `${i + 1}. 📘 ${src.title}\n`;
                });

                await sock.sendMessage(chatId, {
                    text: caption,
                    ...getChannelInfo(userId)
                }, { quoted: message });

            } catch (err) {
                console.error('BibleAI error:', err);
                await sock.sendMessage(chatId, {
                    text: '❌ Error fetching Bible answer: ' + err.message
                });
            }
        }
    },

    // ─── COMMAND: REMOVEBG ─────────────────────────────────────
    'removebg': {
        pattern: 'removebg',
        aliases: ['rmbg', 'bgremove'],
        category: 'AI',
        description: 'Remove background from quoted image',
        usage: '.removebg (reply to image)',
        handler: async (sock, message, args, userId) => {
            const chatId = message.key.remoteJid;
            const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;

            if (!quotedMsg) {
                return await sock.sendMessage(chatId, {
                    text: '📌 Reply to an image message to remove its background'
                });
            }

            const type = getMediaType(quotedMsg);
            if (type !== 'image') {
                return await sock.sendMessage(chatId, {
                    text: '❌ Only image messages are supported'
                });
            }

            const mediaNode = quoted?.imageMessage;
            if (!mediaNode) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Could not extract image content'
                });
            }

            let filePath;
            try {
                filePath = await saveMediaToTemp(sock, mediaNode, type);
                const imageUrl = await uploadToUguu(filePath);
                const result = await axios.get(`https://api.removebg.com/remove?url=${encodeURIComponent(imageUrl)}`);

                if (!result?.data?.status || !result?.data?.result?.data?.cutoutUrl) {
                    return await sock.sendMessage(chatId, {
                        text: '❌ No response from RemoveBG API'
                    });
                }

                const cutoutUrl = result.data.result.data.cutoutUrl;
                await sock.sendMessage(chatId, {
                    image: { url: cutoutUrl },
                    caption: '✨ *Background Removed*',
                    ...getChannelInfo(userId)
                }, { quoted: message });

            } catch (err) {
                console.error('RemoveBG error:', err);
                await sock.sendMessage(chatId, {
                    text: '❌ Failed to remove background. Try a different image.'
                });
            } finally {
                if (filePath && fs.existsSync(filePath)) {
                    try { fs.unlinkSync(filePath); } catch {}
                }
            }
        }
    },

    // ─── COMMAND: VISION ───────────────────────────────────────
    'vision': {
        pattern: 'vision',
        aliases: ['imgai', 'analyze', 'geminivision'],
        category: 'AI',
        description: 'Analyze quoted image using Gemini Vision AI',
        usage: '.vision <question> (reply to image)',
        handler: async (sock, message, args, userId) => {
            const chatId = message.key.remoteJid;
            const text = args.join(' ') || '';
            const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;

            if (!quotedMsg) {
                return await sock.sendMessage(chatId, {
                    text: '📌 Reply to an image message to analyze it'
                });
            }

            if (!text) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Ask a question, e.g. .vision what is in this image?'
                });
            }

            const type = getMediaType(quotedMsg);
            if (type !== 'image') {
                return await sock.sendMessage(chatId, {
                    text: '❌ Only image messages are supported'
                });
            }

            const mediaNode = quoted?.imageMessage;
            if (!mediaNode) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Could not extract image content'
                });
            }

            let filePath;
            try {
                filePath = await saveMediaToTemp(sock, mediaNode, type);
                const imageUrl = await uploadToUguu(filePath);
                const result = await axios.get(`https://api.gemini.vision/analyze?url=${encodeURIComponent(imageUrl)}&q=${encodeURIComponent(text)}`);

                if (!result?.data?.status || !result?.data?.result) {
                    return await sock.sendMessage(chatId, {
                        text: '❌ No response from Vision AI'
                    });
                }

                await sock.sendMessage(chatId, {
                    text: `👁️ *Vision Analysis*\n\n${result.data.result}`,
                    ...getChannelInfo(userId)
                }, { quoted: message });

            } catch (err) {
                console.error('Vision AI error:', err);
                await sock.sendMessage(chatId, {
                    text: '❌ Failed to analyze image: ' + err.message
                });
            } finally {
                if (filePath && fs.existsSync(filePath)) {
                    try { fs.unlinkSync(filePath); } catch {}
                }
            }
        }
    },

    // ─── COMMAND: TRANSCRIBE ──────────────────────────────────
    'transcribe': {
        pattern: 'transcribe',
        aliases: ['speech', 'audio2text', 'whisper'],
        category: 'AI',
        description: 'Transcribe quoted audio or video to text',
        usage: '.transcribe (reply to audio/video)',
        handler: async (sock, message, args, userId) => {
            const chatId = message.key.remoteJid;
            const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;

            if (!quotedMsg) {
                return await sock.sendMessage(chatId, {
                    text: '📌 Reply to an audio or video message to transcribe it'
                });
            }

            const type = getMediaType(quotedMsg);
            if (type === 'unknown') {
                return await sock.sendMessage(chatId, {
                    text: '❌ Unsupported media type'
                });
            }

            const mediaNode = quoted?.[`${type}Message`];
            if (!mediaNode) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Could not extract media content'
                });
            }

            let filePath;
            try {
                filePath = await saveMediaToTemp(sock, mediaNode, type);
                const mediaUrl = await uploadToUguu(filePath);
                const result = await axios.get(`https://api.whisper.transcribe?url=${encodeURIComponent(mediaUrl)}`);

                if (!result?.data?.status || !result?.data?.result?.text) {
                    return await sock.sendMessage(chatId, {
                        text: '❌ No transcription found'
                    });
                }

                await sock.sendMessage(chatId, {
                    text: `📝 *Transcription*\n\n${result.data.result.text}`,
                    ...getChannelInfo(userId)
                }, { quoted: message });

            } catch (err) {
                console.error('Transcription error:', err);
                await sock.sendMessage(chatId, {
                    text: '❌ Failed to transcribe: ' + err.message
                });
            } finally {
                if (filePath && fs.existsSync(filePath)) {
                    try { fs.unlinkSync(filePath); } catch {}
                }
            }
        }
    },

    // ─── COMMAND: SHAZAM ──────────────────────────────────────
    'shazam': {
        pattern: 'shazam',
        aliases: ['identify', 'whatmusic', 'whatsong'],
        category: 'AI',
        description: 'Identify music from quoted audio or video',
        usage: '.shazam (reply to audio/video)',
        handler: async (sock, message, args, userId) => {
            const chatId = message.key.remoteJid;
            const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const userSettings = settings.getUserSettings(userId || 'default');
            const botName = userSettings.botName || 'RAMA-XMD';

            if (!quotedMsg) {
                return await sock.sendMessage(chatId, {
                    text: '📌 Reply to an audio or video message to identify music'
                });
            }

            const type = getMediaType(quotedMsg);
            if (type === 'unknown') {
                return await sock.sendMessage(chatId, {
                    text: '❌ Unsupported media type'
                });
            }

            const mediaNode = quoted?.[`${type}Message`];
            if (!mediaNode) {
                return await sock.sendMessage(chatId, {
                    text: '❌ Could not extract media content'
                });
            }

            let filePath;
            try {
                filePath = await saveMediaToTemp(sock, mediaNode, type);
                const mediaUrl = await uploadToUguu(filePath);
                const result = await axios.get(`https://api.shazam.com/identify?url=${encodeURIComponent(mediaUrl)}`);

                if (!result?.data?.status || !result?.data?.result?.title) {
                    return await sock.sendMessage(chatId, {
                        text: '❌ No music info found'
                    });
                }

                const { title, artists, album, release_date } = result.data.result;

                let txt = `🎵 *${botName} Music ID*\n\n`;
                txt += `*Title:* ${title}\n`;
                if (artists?.length) txt += `*Artists:* ${artists.join(', ')}\n`;
                if (album) txt += `*Album:* ${album}\n`;
                if (release_date) txt += `*Release Date:* ${release_date}`;

                await sock.sendMessage(chatId, {
                    text: txt,
                    ...getChannelInfo(userId)
                }, { quoted: message });

            } catch (err) {
                console.error('Shazam error:', err);
                await sock.sendMessage(chatId, {
                    text: '❌ Failed to identify music: ' + err.message
                });
            } finally {
                if (filePath && fs.existsSync(filePath)) {
                    try { fs.unlinkSync(filePath); } catch {}
                }
            }
        }
    }
};