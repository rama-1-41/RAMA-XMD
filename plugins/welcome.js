// plugins/welcome.js
const config = require('../config');   // your bot config
const { getBuffer, getGroupAdmins } = require('../lib/functions'); // adjust imports
const Canvas = require('catozolala-card-canvas'); // optional for images

// Store toggle states (better to use database in production)
const welcomeStates = {};   // groupId: true/false
const goodbyeStates = {};  // groupId: true/false

// ─── Main handler ──────────────────────────────────────────────
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

// ─── Welcome message ──────────────────────────────────────────
async function sendWelcome(conn, groupId, newMember) {
    if (welcomeStates[groupId] === false) return;
    const groupName = (await conn.groupMetadata(groupId)).subject || 'Group';
    const memberName = newMember.pushName || newMember.id.split('@')[0];
    const memberMention = `@${newMember.id.split('@')[0]}`;

    // Build welcome text
    let msg = `👋 *Welcome to ${groupName}* @${newMember.id.split('@')[0]}\n`;
    msg += `▸ Name: ${memberName}\n`;
    msg += `▸ Number: ${newMember.id.split('@')[0]}\n`;
    msg += `▸ You are member #${(await conn.groupMetadata(groupId)).participants.length}\n\n`;
    msg += `📌 *Read the group description* and enjoy!`;

    try {
        // Optional: send image with welcome card
        const imageBuffer = await generateWelcomeCard(groupName, memberName, newMember.id);
        if (imageBuffer) {
            await conn.sendMessage(groupId, {
                image: imageBuffer,
                caption: msg,
                mentions: [newMember.id]
            });
        } else {
            await conn.sendMessage(groupId, {
                text: msg,
                mentions: [newMember.id]
            });
        }
    } catch (e) {
        console.error('Welcome error:', e);
        await conn.sendMessage(groupId, { text: msg, mentions: [newMember.id] });
    }
}

// ─── Goodbye message ──────────────────────────────────────────
async function sendGoodbye(conn, groupId, leavingUser) {
    if (goodbyeStates[groupId] === false) return;
    const groupName = (await conn.groupMetadata(groupId)).subject || 'Group';
    const memberName = leavingUser.pushName || leavingUser.id.split('@')[0];
    const msg = `👋 *${memberName}* left ${groupName}. Sad to see you go!`;
    await conn.sendMessage(groupId, { text: msg });
}

// ─── Generate welcome image (optional) ──────────────────────
async function generateWelcomeCard(groupName, memberName, userId) {
    try {
        const avatar = await conn.profilePictureUrl(userId, 'image').catch(() => null);
        const buffer = await Canvas.welcomeCard({
            avatar: avatar,
            username: memberName,
            groupName: groupName,
            bg: 'https://example.com/bg.jpg' // optional background
        });
        return buffer;
    } catch (e) {
        return null;
    }
}

// ─── Commands: toggle welcome / goodbye ──────────────────────
const commands = [
    {
        pattern: 'welcome',
        desc: 'Toggle welcome messages on/off',
        category: 'group',
        async handler(conn, message, args) {
            const groupId = message.key.remoteJid;
            if (!groupId.endsWith('@g.us')) return conn.sendMessage(groupId, { text: 'Group only!' });
            const isAdmin = (await getGroupAdmins(conn, groupId)).includes(message.key.participant);
            if (!isAdmin) return conn.sendMessage(groupId, { text: 'Only admins can toggle.' });
            const state = args[0]?.toLowerCase();
            if (state === 'on') {
                welcomeStates[groupId] = true;
                await conn.sendMessage(groupId, { text: '✅ Welcome messages are now ON.' });
            } else if (state === 'off') {
                welcomeStates[groupId] = false;
                await conn.sendMessage(groupId, { text: '❌ Welcome messages are now OFF.' });
            } else {
                const current = welcomeStates[groupId] !== false ? 'ON' : 'OFF';
                await conn.sendMessage(groupId, { text: `Welcome messages are currently *${current}*.` });
            }
        }
    },
    {
        pattern: 'goodbye',
        desc: 'Toggle goodbye messages on/off',
        category: 'group',
        async handler(conn, message, args) {
            const groupId = message.key.remoteJid;
            if (!groupId.endsWith('@g.us')) return conn.sendMessage(groupId, { text: 'Group only!' });
            const isAdmin = (await getGroupAdmins(conn, groupId)).includes(message.key.participant);
            if (!isAdmin) return conn.sendMessage(groupId, { text: 'Only admins can toggle.' });
            const state = args[0]?.toLowerCase();
            if (state === 'on') {
                goodbyeStates[groupId] = true;
                await conn.sendMessage(groupId, { text: '✅ Goodbye messages are now ON.' });
            } else if (state === 'off') {
                goodbyeStates[groupId] = false;
                await conn.sendMessage(groupId, { text: '❌ Goodbye messages are now OFF.' });
            } else {
                const current = goodbyeStates[groupId] !== false ? 'ON' : 'OFF';
                await conn.sendMessage(groupId, { text: `Goodbye messages are currently *${current}*.` });
            }
        }
    }
];

// ─── Export ───────────────────────────────────────────────────
module.exports = {
    handleGroupUpdate,
    commands,
    // If your bot uses a different event listener, you may need to attach it yourself
};