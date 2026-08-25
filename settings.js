// settings.js - Multi-user aware
const sessionManager = require('./lib/sessionManager');

// Default/Global settings (used as template for new users)
const defaultSettings = {
    packname: 'RAMA-XMD',
    author: '‎',
    botName: "RAMA-XMD",
    botOwner: 'mr presenter',
    ownerNumber: '254769769295',
    giphyApiKey: 'qnl7ssQChTdPjsKta2Ax2LMaGXz303tq',
    commandMode: "public",
    maxStoreMessages: 20,
    storeWriteInterval: 10000,
    description: "This is a bot for managing group plugins and automating tasks.",
    version: "3.0.7",
    updateZipUrl: "https://github.com/rama-1-41/RAMA-XMD",
};

class SettingsManager {
    constructor() {
        this.globalSettings = defaultSettings;
    }

    // Get settings for a specific user
    getUserSettings(userId) {
        try {
            const userConfig = sessionManager.getUserConfig(userId);
            return {
                packname: userConfig.packname || defaultSettings.packname,
                author: userConfig.author || defaultSettings.author,
                botName: userConfig.botName || defaultSettings.botName,
                botOwner: userConfig.botOwner || defaultSettings.botOwner,
                ownerNumber: userConfig.ownerNumber || defaultSettings.ownerNumber,
                giphyApiKey: userConfig.giphyApiKey || defaultSettings.giphyApiKey,
                commandMode: userConfig.commandMode || defaultSettings.commandMode,
                maxStoreMessages: userConfig.maxStoreMessages || defaultSettings.maxStoreMessages,
                storeWriteInterval: userConfig.storeWriteInterval || defaultSettings.storeWriteInterval,
                description: userConfig.description || defaultSettings.description,
                version: userConfig.version || defaultSettings.version,
                updateZipUrl: userConfig.updateZipUrl || defaultSettings.updateZipUrl,
                // Additional user-specific settings
                welcomeEnabled: userConfig.welcomeEnabled !== undefined ? userConfig.welcomeEnabled : true,
                antilinkEnabled: userConfig.antilinkEnabled !== undefined ? userConfig.antilinkEnabled : true,
                chatbotEnabled: userConfig.chatbotEnabled !== undefined ? userConfig.chatbotEnabled : true,
            };
        } catch {
            // Return default settings if user not found
            return { ...defaultSettings };
        }
    }

    // Update settings for a specific user
    updateUserSettings(userId, newSettings) {
        try {
            const current = sessionManager.getUserConfig(userId);
            sessionManager.updateUserConfig(userId, { ...current, ...newSettings });
            return true;
        } catch {
            return false;
        }
    }

    // Get default settings (for non-multi-user mode)
    getDefaultSettings() {
        return { ...defaultSettings };
    }

    // Get global settings (applies to all users)
    getGlobalSettings() {
        return this.globalSettings;
    }

    // Update global settings
    updateGlobalSettings(newSettings) {
        this.globalSettings = { ...this.globalSettings, ...newSettings };
    }

    // Get owner number (for compatibility with existing code)
    getOwnerNumber(userId) {
        const settings = this.getUserSettings(userId);
        return settings.ownerNumber;
    }

    // Get bot name (for compatibility with existing code)
    getBotName(userId) {
        const settings = this.getUserSettings(userId);
        return settings.botName;
    }

    // Get pack name (for compatibility with existing code)
    getPackName(userId) {
        const settings = this.getUserSettings(userId);
        return settings.packname;
    }
}

// Create singleton instance
const settingsManager = new SettingsManager();

// Export for backward compatibility (single-user mode)
module.exports = {
    // Export default settings as before
    ...defaultSettings,
    
    // Export manager functions
    getUserSettings: settingsManager.getUserSettings.bind(settingsManager),
    updateUserSettings: settingsManager.updateUserSettings.bind(settingsManager),
    getDefaultSettings: settingsManager.getDefaultSettings.bind(settingsManager),
    getGlobalSettings: settingsManager.getGlobalSettings.bind(settingsManager),
    getOwnerNumber: settingsManager.getOwnerNumber.bind(settingsManager),
    getBotName: settingsManager.getBotName.bind(settingsManager),
    getPackName: settingsManager.getPackName.bind(settingsManager),
    settingsManager: settingsManager,
};