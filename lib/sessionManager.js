// lib/sessionManager.js
const fs = require('fs');
const path = require('path');

class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.sessionsDir = path.join(__dirname, '..', 'sessions');
        
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
    }

    getSession(userId) {
        if (!this.sessions.has(userId)) {
            this.sessions.set(userId, this.createSession(userId));
        }
        return this.sessions.get(userId);
    }

    createSession(userId) {
        const sessionPath = path.join(this.sessionsDir, `${userId}.json`);
        const configPath = path.join(this.sessionsDir, `${userId}-config.json`);
        
        let userConfig = {};
        if (fs.existsSync(configPath)) {
            userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } else {
            try {
                const defaultConfig = require('../config.js');
                userConfig = {
                    botName: `${defaultConfig.botName || 'RAMA-XMD'}-${userId}`,
                    ownerNumber: defaultConfig.ownerNumber || '254769769295',
                    packName: defaultConfig.packName || 'RAMA-XMD',
                    newsletterJid: defaultConfig.newsletterJid || '120363401269012709@newsletter',
                    channelUrl: defaultConfig.channelUrl || 'https://whatsapp.com/channel/0029VbDEaph2P59lnHWK6R3N',
                    prefix: defaultConfig.prefix || '.',
                    welcomeEnabled: true,
                };
            } catch {
                userConfig = {
                    botName: `RAMA-XMD-${userId}`,
                    ownerNumber: '254769769295',
                    packName: 'RAMA-XMD',
                    newsletterJid: '120363401269012709@newsletter',
                    prefix: '.',
                };
            }
            fs.writeFileSync(configPath, JSON.stringify(userConfig, null, 2));
        }

        return {
            userId: userId,
            sessionFile: sessionPath,
            config: userConfig,
            pluginStates: {},
            userData: {},
        };
    }

    getUserConfig(userId) {
        const session = this.getSession(userId);
        return session.config;
    }

    updateUserConfig(userId, newConfig) {
        const session = this.getSession(userId);
        session.config = { ...session.config, ...newConfig };
        const configPath = path.join(this.sessionsDir, `${userId}-config.json`);
        fs.writeFileSync(configPath, JSON.stringify(session.config, null, 2));
    }

    getAllUsers() {
        const files = fs.readdirSync(this.sessionsDir);
        const users = [];
        for (const f of files) {
            if (f.endsWith('-config.json')) {
                users.push(f.replace('-config.json', ''));
            }
        }
        return users;
    }
}

module.exports = new SessionManager();