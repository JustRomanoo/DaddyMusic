const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const config = require('./config');

const app = express();
app.get('/', (req, res) => {
    res.send('Papa Music Bot is alive');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Keep-alive server running on port ${PORT}`);
});

// Initialize Client with necessary Intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// For tracking panels: guildId -> { channelId, messageId }
const fs = require('fs');
const path = require('path');
const panelsPath = path.join(__dirname, '../panels.json');

client.activePanels = new Map();

// Load panels from file if exists
if (fs.existsSync(panelsPath)) {
    try {
        const data = JSON.parse(fs.readFileSync(panelsPath, 'utf-8'));
        client.activePanels = new Map(Object.entries(data));
        console.log(`Loaded ${client.activePanels.size} active panels from persistence.`);
    } catch (e) {
        console.error('Failed to load panels.json');
    }
}

// Helper to save panels
client.savePanels = () => {
    const data = Object.fromEntries(client.activePanels);
    fs.writeFileSync(panelsPath, JSON.stringify(data, null, 2));
};

// Override Map methods to auto-save
const originalSet = client.activePanels.set.bind(client.activePanels);
const originalDelete = client.activePanels.delete.bind(client.activePanels);
client.activePanels.set = (...args) => {
    const res = originalSet(...args);
    client.savePanels();
    return res;
};
client.activePanels.delete = (...args) => {
    const res = originalDelete(...args);
    client.savePanels();
    return res;
};

// Initialize Music Player
const PlayerManager = require('./utils/playerManager');
const ConfigManager = require('./utils/configManager');
const SessionManager = require('./utils/sessionManager');

client.manager = new PlayerManager(client);
client.guildConfigs = ConfigManager;
client.sessionManager = SessionManager;

// Load Handlers
['commandHandler', 'eventHandler'].forEach(handler => {
    require(`./handlers/${handler}`)(client);
});

// Login
if (!config.token || config.token === 'YOUR_DISCORD_BOT_TOKEN_HERE') {
    console.error('❌ ERROR: Discord Token not found. Please set DISCORD_TOKEN in your .env file.');
    process.exit(1);
}

client.login(config.token).catch(err => {
    console.error('❌ ERROR: Failed to login to Discord.');
    console.error(err);
});
