// settings.js
require('dotenv').config();

module.exports = {
    // Owner phone number (without @s.whatsapp.net)
    ownerNumber: process.env.OWNER_NUMBER || '254757829372',
    
    // Sudo numbers (comma separated in .env)
    sudoNumbers: process.env.SUDO_NUMBERS ? process.env.SUDO_NUMBERS.split(',') : [],
};