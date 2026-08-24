// plugins/welcome.js (simplified)
const config = require('../config');

const welcomeStates = {};
const goodbyeStates = {};

async function getGroupAdmins(conn, groupId) {
    try {
        const metadata = await conn.groupMetadata(groupId);
        return metadata.participants
            .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
            .map(p => p.id);
    } catch {
        return [];
    }
}

async function handleGroupUpdate(conn, update) {
    const { id, participants, action } = update;
    if (!id) return;
    if (action === 'add') {
        for (const user of participants) {
            await sendWelcome(conn, id, user);
        }
    } else if (action === 'remove') {
        for (const user of participants) {
            await sendGoodbye(conn, id, user);
        }
    }
}

async function sendWelcome(conn, groupId, newMember) {
    if (welcomeStates[groupId] === false) return;
    const metadata = await conn.groupMetadata(groupId);
    const groupName = metadata.subject || 'Group';
    const memberName = newMember.pushName || newMember.id.split('@')[0];
    const memberNumber = newMember.id.split('@')[0];
    
    const msg = `👋 *Welcome to ${groupName}* @${memberNumber}\n▸ Name: ${memberName}\n▸ Number: ${memberNumber}\n▸ Member #${metadata.participants.length}\n\n📌 Read the group description!`;
    
    await conn.sendMessage(groupId, { text: msg, mentions: [newMember.id] });
}

async function sendGoodbye(conn, groupId, leavingUser) {
    if (goodbyeStates[groupId] === false) return;
    const metadata = await conn.groupMetadata(groupId);
    const groupName = metadata.subject || 'Group';
    const memberName = leavingUser.pushName || leavingUser.id.split('@')[0];
    await conn.sendMessage(groupId, { text: `👋 ${memberName} left ${groupName}.` });
}

module.exports = {
    handleGroupUpdate,
    commands: [
        {
            pattern: 'welcome',
            desc: 'Toggle welcome messages',
            category: 'group',
            async handler(conn, message, args) {
                const groupId = message.key.remoteJid;
                if (!groupId.endsWith('@g.us')) return;
                const admins = await getGroupAdmins(conn, groupId);
                if (!admins.includes(message.key.participant)) return;
                
                const state = args[0]?.toLowerCase();
                if (state === 'on') {
                    welcomeStates[groupId] = true;
                    await conn.sendMessage(groupId, { text: '✅ Welcome ON' });
                } else if (state === 'off') {
                    welcomeStates[groupId] = false;
                    await conn.sendMessage(groupId, { text: '❌ Welcome OFF' });
                } else {
                    const current = welcomeStates[groupId] !== false ? 'ON' : 'OFF';
                    await conn.sendMessage(groupId, { text: `Welcome: *${current}*` });
                }
            }
        },
        {
            pattern: 'goodbye',
            desc: 'Toggle goodbye messages',
            category: 'group',
            async handler(conn, message, args) {
                const groupId = message.key.remoteJid;
                if (!groupId.endsWith('@g.us')) return;
                const admins = await getGroupAdmins(conn, groupId);
                if (!admins.includes(message.key.participant)) return;
                
                const state = args[0]?.toLowerCase();
                if (state === 'on') {
                    goodbyeStates[groupId] = true;
                    await conn.sendMessage(groupId, { text: '✅ Goodbye ON' });
                } else if (state === 'off') {
                    goodbyeStates[groupId] = false;
                    await conn.sendMessage(groupId, { text: '❌ Goodbye OFF' });
                } else {
                    const current = goodbyeStates[groupId] !== false ? 'ON' : 'OFF';
                    await conn.sendMessage(groupId, { text: `Goodbye: *${current}*` });
                }
            }
        }
    ]
};