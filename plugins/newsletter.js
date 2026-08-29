// plugins/newsletter.js – Works exactly like channelreact
module.exports = {
    name: 'newsletter',
    description: 'Get WhatsApp Channel information',
    category: 'tools',
    usage: '.newsletter <channel link>',
    aliases: ['.nl', '.channelinfo'],
    
    handler: async (sock, chatId, message, args) => {
        try {
            const userMessage = (
                message.message?.conversation?.trim() ||
                message.message?.extendedTextMessage?.text?.trim() ||
                ''
            );

            const args2 = userMessage.split(' ').slice(1).join(' ');

            if (!args2) {
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

            const match = args2.match(/whatsapp\.com\/channel\/([\w-]+)/);
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

            // EXACT same method as channelreact
            const channelMeta = await sock.newsletterMetadata("invite", channelId);

            if (!channelMeta || !channelMeta.id) {
                return await sock.sendMessage(chatId, {
                    text: "❌ *Channel not found or inaccessible.*\nMake sure the invite link is correct.",
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

            const infoText = `
╭━━〔 *RAMA-XMD*⚡ 〕━⬣
┃✨ *Channel Info*
┃📡 *Name:* ${channelMeta.name || 'Unknown'}
┃🔖 *ID:* ${channelMeta.id}
┃👥 *Followers:* ${channelMeta.subscribers?.toLocaleString() || 'N/A'}
┃🗓️ *Created:* ${channelMeta.creation_time ? new Date(channelMeta.creation_time * 1000).toLocaleString() : 'Unknown'}
╰──────────────⬣
> 🔗 *Powered By RAMA-XMD* 🚀`;

            const preview = channelMeta.preview;
            
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

        } catch (error) {
            console.error('❌ Newsletter Error:', error);
            
            let errorMessage = "⚠️ *Error:* Failed to fetch channel info.";
            
            if (error.message && error.message.includes("newsletter")) {
                errorMessage = "⚠️ *Channel Error:* Cannot access channel. Make sure the invite link is valid.";
            }
            
            await sock.sendMessage(chatId, {
                text: errorMessage,
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