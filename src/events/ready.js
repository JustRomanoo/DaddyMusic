const { Events } = require('discord.js');

module.exports = {
    name: Events.ClientReady,
    once: true,
    execute(client) {
        console.log(`✅ Logged in as ${client.user.tag}`);
        console.log(`Prefix: !`);
        console.log(`Ready to handle music controls!`);
    }
};
