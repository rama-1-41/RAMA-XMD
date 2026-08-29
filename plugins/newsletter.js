// plugins/newsletter.js – Get WhatsApp Channel Info
const axios = require('axios');

module.exports = {
    name: 'newsletter',
    description: 'Get WhatsApp Channel information',
    category: 'tools',
    usage: '.newsletter <channel link>',
    aliases: ['.nl', '.channelinfo'],
    
    handler: async (sock, chatId, message, args) => {
        try {
            // Get the full message text
            const userMessage = message.message?.conversation?.trim() ||
                               message.message?.extendedTextMessage?.text?.trim() ||
                               '';

            // Extract the channel link from args or message
            let channelLink = args.join(' ') || userMessage.replace('.newsletter', '').trim();

            // If no link provided
            if (!channelLink) {
                return await sock.sendMessage(chatId, {
                    text: `❎ *Please provide a WhatsApp Channel link.*\n\n📌 *Example:*\n.newsletter https://whatsapp.com/channel/xxxxxxxxxx`,
                    contextInfo: {
                        forwardingScore: 999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363428121144787@newsletter',
                            newsletterName: 'RAMA-XMD MD',
                            serverMessageId: -1
                        }
                    }
                }, { quoted: message });
            }

            // Extract channel ID from link
            const match = channelLink.match(/whatsapp\.com\/channel\/([\w-]+)/);
            if (!match) {
                return await sock.sendMessage(chatId, {
                    text: `⚠️ *Invalid channel link!*\n\nMake sure it looks like:\nhttps://whatsapp.com/channel/xxxxxxxxx`,
                    contextInfo: {
                        forwardingScore: 999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363428121144787@newsletter',
                            newsletterName: 'RAMA-XMD MD',
                            serverMessageId: -1
                        }
                    }
                }, { quoted: message });
            }

            const channelId = match[1];

            // Send processing message
            await sock.sendMessage(chatId, {
                text: `⏳ *Fetching channel info...*\n\n📡 Channel ID: ${channelId}`
            }, { quoted: message });

            // Fetch channel metadata using the correct method
            let channelMeta = null;
            let imageUrl = null;

            try {
                // Method 1: Try newsletterMetadata
                if (sock.newsletterMetadata) {
                    channelMeta = await sock.newsletterMetadata("invite", channelId);
                }
                // Method 2: Try getNewsletterInfo
                else if (sock.getNewsletterInfo) {
                    channelMeta = await sock.getNewsletterInfo(channelId);
                }
                // Method 3: Try getNewsletterMetadata
                else if (sock.getNewsletterMetadata) {
                    channelMeta = await sock.getNewsletterMetadata(channelId);
                }
                // Method 4: Try using the invite link directly
                else {
                    // Try to fetch via API
                    const response = await axios.get(`https://whatsapp.com/channel/${channelId}`, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        },
                        timeout: 10000
                    });
                    
                    // Try to extract info from HTML
                    const html = response.data;
                    const nameMatch = html.match(/<title>(.*?)<\/title>/);
                    const name = nameMatch ? nameMatch[1].replace(' - WhatsApp Channel', '').trim() : 'Unknown';
                    
                    // Try to get preview image
                    const imgMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
                    if (imgMatch) imageUrl = imgMatch[1];
                    
                    channelMeta = {
                        id: channelId,
                        name: name,
                        subscribers: 'N/A',
                        creation_time: null,
                        preview: imageUrl || null
                    };
                }
            } catch (error) {
                console.error('Error fetching newsletter metadata:', error);
                
                // Try alternative method - get from invite link
                try {
                    const inviteLink = `https://whatsapp.com/channel/${channelId}`;
                    const response = await axios.get(inviteLink, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        },
                        timeout: 10000
                    });
                    
                    const html = response.data;
                    const nameMatch = html.match(/<title>(.*?)<\/title>/);
                    const name = nameMatch ? nameMatch[1].replace(' - WhatsApp Channel', '').trim() : 'Unknown';
                    const imgMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
                    if (imgMatch) imageUrl = imgMatch[1];
                    
                    channelMeta = {
                        id: channelId,
                        name: name,
                        subscribers: 'N/A',
                        creation_time: null,
                        preview: imageUrl || null
                    };
                } catch (e2) {
                    console.error('Fallback method also failed:', e2);
                }
            }

            // If still no channelMeta, return error
            if (!channelMeta || !channelMeta.id) {
                return await sock.sendMessage(chatId, {
                    text: "❌ *Channel not found or inaccessible.*\n\nMake sure the invite link is correct and the channel exists.\n\n💡 *Try:*\n• Check the link format\n• Make sure the channel is public\n• Try again with a valid link",
                    contextInfo: {
                        forwardingScore: 999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363428121144787@newsletter',
                            newsletterName: 'RAMA-XMD MD',
                            serverMessageId: -1
                        }
                    }
                }, { quoted: message });
            }

            // Build the info text
            const subscriberCount = channelMeta.subscribers || channelMeta.followers || 'N/A';
            const formattedSubs = typeof subscriberCount === 'number' ? subscriberCount.toLocaleString() : subscriberCount;
            
            const creationTime = channelMeta.creation_time || channelMeta.createdAt || null;
            const formattedDate = creationTime ? 
                new Date(creationTime * 1000 || creationTime).toLocaleString() : 
                'Unknown';

            const infoText = `
╭━━〔 *📡 Channel Info* 〕━━⬣
│
├─✨ *Name:* ${channelMeta.name || 'Unknown'}
├─🔖 *ID:* ${channelMeta.id}
├─👥 *Followers:* ${formattedSubs}
├─🗓️ *Created:* ${formattedDate}
│
├─🔗 *Link:* https://whatsapp.com/channel/${channelId}
│
╰──────────────⬣
> 🔗 *Powered By RAMA-XMD* 🚀`;

            // Get the preview image
            const preview = channelMeta.preview || channelMeta.profilePicUrl || channelMeta.imageUrl || imageUrl;
            
            // Send the response with or without image
            try {
                if (preview) {
                    const imageUrl = preview.startsWith('http') ? preview : `https://pps.whatsapp.net${preview}`;
                    await sock.sendMessage(chatId, {
                        image: { url: imageUrl },
                        caption: infoText,
                        contextInfo: {
                            forwardingScore: 999,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363428121144787@newsletter',
                                newsletterName: 'RAMA-XMD MD',
                                serverMessageId: -1
                            }
                        }
                    }, { quoted: message });
                } else {
                    await sock.sendMessage(chatId, {
                        text: infoText,
                        contextInfo: {
                            forwardingScore: 999,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363428121144787@newsletter',
                                newsletterName: 'RAMA-XMD MD',
                                serverMessageId: -1
                            }
                        }
                    }, { quoted: message });
                }
            } catch (sendError) {
                console.error('Error sending message:', sendError);
                // Fallback: send without image
                await sock.sendMessage(chatId, {
                    text: infoText,
                    contextInfo: {
                        forwardingScore: 999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363428121144787@newsletter',
                            newsletterName: 'RAMA-XMD MD',
                            serverMessageId: -1
                        }
                    }
                }, { quoted: message });
            }

        } catch (error) {
            console.error('❌ Newsletter Error:', error);
            
            let errorMessage = "⚠️ *Error:* Failed to fetch channel info.";
            
            if (error.message && error.message.includes("newsletter")) {
                errorMessage = "⚠️ *Channel Error:* Cannot access channel. Make sure the invite link is valid.";
            } else if (error.message && error.message.includes("timeout")) {
                errorMessage = "⏰ *Timeout:* The request took too long. Please try again.";
            } else if (error.message && error.message.includes("404")) {
                errorMessage = "❌ *Not Found:* The channel does not exist or the link is invalid.";
            }
            
            await sock.sendMessage(chatId, {
                text: errorMessage + `\n\n💡 *Try:*\n• Check the link format\n• Make sure the channel exists\n• Try again later`,
                contextInfo: {
                    forwardingScore: 999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363428121144787@newsletter',
                        newsletterName: 'RAMA-XMD MD',
                        serverMessageId: -1
                    }
                }
            }, { quoted: message });
        }
    }
};