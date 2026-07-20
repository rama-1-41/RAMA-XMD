// commands/prefix.js
const isOwnerOrSudo = require('../lib/isowner');

module.exports = {
    pattern: 'prefix',
    tags: ['settings'],
    description: 'Show current bot prefix',
    
    async execute(conn, message, m, options) {
        try {
            const { reply, q, args, from, sender } = options;
            const PREFIX = process.env.PREFIX || ".";
            
            // Check if user is owner
            const isOwner = await isOwnerOrSudo(sender, conn, from);
            if (!isOwner) {
                await conn.sendMessage(from, { 
                    text: `❌ Owner only command` 
                }, { quoted: message });
                return;
            }
            
            await conn.sendMessage(from, { 
                text: `📌 Current prefix: ${PREFIX}` 
            }, { quoted: message });
            
        } catch (error) {
            console.error("Error in prefix command:", error);
        }
    }
};