const PanelBuilder = require('../utils/panelBuilder');

module.exports = {
    name: 'm',
    description: 'Sends the music control panel.',
    async execute(message, args) {
        const { channel, guild, client } = message;

        // 1. Check if there's an existing panel in this guild and delete it
        if (client.activePanels.has(guild.id)) {
            const oldPanel = client.activePanels.get(guild.id);
            try {
                const oldChannel = await client.channels.fetch(oldPanel.channelId);
                const oldMsg = await oldChannel.messages.fetch(oldPanel.messageId);
                if (oldMsg) await oldMsg.delete();
            } catch (err) {
                // Ignore if message was already deleted or not found
            }
        }

        // 2. Get current player state
        const player = client.manager.kazagumo.players.get(guild.id);
        const state = {
            currentSong: player?.queue.current?.title || 'None',
            queue: player?.queue.map((t, i) => `${i + 1}. ${t.title}`).slice(0, 5) || [],
            isPaused: player?.paused || false,
            loopMode: player?.loop || 'Off',
            hasPlayer: Boolean(player),
            hasQueue: Boolean(player?.queue.length)
        };

        // 3. Build the new panel
        const embed = PanelBuilder.buildEmbed(state);
        const components = PanelBuilder.buildComponents(state);

        // 4. Send the panel
        const panelMessage = await channel.send({
            embeds: [embed],
            components: components
        });

        // 5. Update the active panels tracker
        client.activePanels.set(guild.id, {
            channelId: channel.id,
            messageId: panelMessage.id
        });

        // 6. Delete the command message (!m) to keep it clean
        try {
            await message.delete();
        } catch (err) {
            // Might lack permissions
        }
    }
};
