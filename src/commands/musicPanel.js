const PanelBuilder = require('../utils/panelBuilder');
const { Collection } = require('discord.js');

const panelCooldowns = new Collection();

module.exports = {
    name: 'm',
    description: 'Sends the music control panel.',
    async execute(message, args) {
        const { channel, guild, client } = message;

        // Debounce: prevent duplicate panel from reconnection double-emits
        const cooldownKey = `${guild.id}-${message.author.id}`;
        if (panelCooldowns.has(cooldownKey)) return;
        panelCooldowns.set(cooldownKey, Date.now());
        setTimeout(() => panelCooldowns.delete(cooldownKey), 2000);

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
        const guildConfig = client.guildConfigs.get(guild.id);
        const djRole = guildConfig?.djRoleId ? guild.roles.cache.get(guildConfig.djRoleId) : null;
        const queueList = player?.queue.map((t, i) => {
            const req = t.requester ? `(by <@${t.requester.id}>)` : '';
            return `${i + 1}. ${t.title} ${req}`;
        }) || [];
        const state = {
            currentSong: player?.queue.current?.title || 'None',
            queue: queueList,
            isPaused: player?.paused || false,
            loopMode: player?.loop || 'Off',
            position: player?.position || 0,
            duration: player?.queue.current?.length || 0,
            requester: player?.queue.current?.requester ? `<@${player.queue.current.requester.id}>` : 'None',
            thumbnail: player?.queue.current?.thumbnail || client.user.displayAvatarURL({ size: 512, extension: 'png' }),
            volume: player?.volume || 100,
            isLocked: guildConfig?.isLocked || false,
            djRoleName: djRole ? djRole.name : 'Not Set',
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
