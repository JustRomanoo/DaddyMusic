const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, RoleSelectMenuBuilder, MessageFlags } = require('discord.js');
const config = require('../config');

class PanelBuilder {
    /**
     * Builds the main music control panel embed.
     */
    static buildEmbed(state = {}) {
        const { 
            currentSong = 'None', 
            queue = [], 
            isPaused = false, 
            loopMode = 'Off', 
            position = 0, 
            duration = 0,
            requester = 'N/A',
            thumbnail = null,
            volume = 100,
            isLocked = false,
            djRoleName = 'Not Set'
        } = state;

        const progressBar = this.createProgressBar(position, duration);
        const statusEmoji = isPaused ? '⏸ Paused' : '▶ Playing';
        const lockStatus = isLocked ? '🔒 Locked' : '🔓 Open';

        const embed = new EmbedBuilder()
            .setTitle('🎵 Music Control Panel')
            .setColor(isLocked ? config.colors.danger : (isPaused ? config.colors.warning : config.colors.primary))
            .setThumbnail(thumbnail)
            .addFields(
                { name: '🎶 Now Playing', value: `**${currentSong}**`, inline: false },
                { name: '👤 Requester', value: requester, inline: true },
                { name: '🔊 Volume', value: `\`${volume}%\``, inline: true },
                { name: '🔁 Loop Mode', value: `\`${loopMode}\``, inline: true },
                { name: '🛡 Session', value: `Role: \`${djRoleName}\` | ${lockStatus}`, inline: false },
                { name: '⏱ Progress', value: `\`${progressBar}\` (${this.formatTime(position)} / ${this.formatTime(duration)})`, inline: false },
                { name: '📜 Up Next', value: queue.length > 0 ? queue.slice(0, 5).join('\n') : 'The queue is empty.', inline: false }
            )
            .setTimestamp()
            .setFooter({ text: `Papa Music Bot • Status: ${statusEmoji}` });

        return embed;
    }

    /**
     * Builds the main control buttons.
     */
    static buildComponents(state = {}) {
        const { isPaused = false, loopMode = 'Off', hasPlayer = false } = state;

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(isPaused ? 'music_play' : 'music_pause')
                .setLabel(isPaused ? 'Resume' : 'Pause')
                .setEmoji(isPaused ? '▶' : '⏸')
                .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary)
                .setDisabled(!hasPlayer),
            new ButtonBuilder()
                .setCustomId('music_skip')
                .setLabel('Skip')
                .setEmoji('⏭')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasPlayer),
            new ButtonBuilder()
                .setCustomId('music_shuffle')
                .setLabel('Shuffle')
                .setEmoji('🔀')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!hasPlayer),
            new ButtonBuilder()
                .setCustomId('music_leave')
                .setLabel('Leave')
                .setEmoji('🚪')
                .setStyle(ButtonStyle.Danger)
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('music_loop')
                .setLabel(`Loop: ${loopMode}`)
                .setEmoji('🔁')
                .setStyle(loopMode !== 'Off' ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(!hasPlayer),
            new ButtonBuilder()
                .setCustomId('music_add_modal')
                .setLabel('Add Song')
                .setEmoji('➕')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('music_settings_open')
                .setLabel('Settings')
                .setEmoji('⚙️')
                .setStyle(ButtonStyle.Secondary)
        );

        const row3 = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('music_volume_select')
                .setPlaceholder('🔊 Adjust Volume')
                .setDisabled(!hasPlayer)
                .addOptions([
                    { label: '25%', value: '25' },
                    { label: '50%', value: '50' },
                    { label: '75%', value: '75' },
                    { label: '100%', value: '100' },
                    { label: '150%', value: '150' }
                ])
        );

        const row4 = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('music_playlist_select')
                .setPlaceholder('📂 Load Playlist')
                .addOptions([
                    ...config.playlists,
                    { label: '➕ Load Custom Playlist URL', value: 'playlist_custom_url', description: 'Paste a Spotify/YouTube playlist link' }
                ])
        );

        const components = [row1, row2, row3, row4];
        if (state.queue && state.queue.length > 0) {
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('music_queue_select')
                    .setPlaceholder('🎧 View / Jump in Queue')
                    .addOptions(state.queue.slice(0, 25).map((t, i) => ({
                        label: t.substring(0, 100),
                        value: `queue_jump_${i + 1}`
                    })))
            ));
        }

        return components;
    }

    /**
     * Builds the Settings Dashboard Embed and Components.
     */
    static buildSettingsPanel(state = {}) {
        const { djRoleName = 'Not Set', isLocked = false } = state;

        const embed = new EmbedBuilder()
            .setTitle('⚙️ Music Settings Dashboard')
            .setDescription('Configure how music sessions work in this server.')
            .setColor(config.colors.primary)
            .addFields(
                { name: '🎧 DJ Role', value: `\`@${djRoleName}\``, inline: true },
                { name: '🔒 Default Lock', value: isLocked ? '✅ Enabled' : '❌ Disabled', inline: true }
            )
            .setFooter({ text: 'Only Admins and Moderators can modify these settings.' });

        const row1 = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('setting_dj_role')
                .setPlaceholder('Select a role to be the DJ role...'),
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('setting_lock_toggle')
                .setLabel(isLocked ? 'Unlock Session' : 'Lock Session')
                .setEmoji(isLocked ? '🔓' : '🔒')
                .setStyle(isLocked ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('setting_back_to_panel')
                .setLabel('Back to Player')
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Secondary)
        );

        return { embeds: [embed], components: [row1, row2], flags: [MessageFlags.Ephemeral] };
    }

    /**
     * Creates a simple text-based progress bar
     */
    static createProgressBar(current, total) {
        if (!total || total === 0) return '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';
        const size = 20;
        const progress = Math.min(size, Math.round((size * current) / total));
        const emptyProgress = size - progress;

        const progressText = '▇'.repeat(progress);
        const emptyProgressText = '—'.repeat(emptyProgress);
        
        return progressText + emptyProgressText;
    }

    /**
     * Formats milliseconds to MM:SS
     */
    static formatTime(ms) {
        if (isNaN(ms) || ms < 0) return '00:00';
        const seconds = Math.floor((ms / 1000) % 60);
        const minutes = Math.floor((ms / (1000 * 60)) % 60);
        const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);

        const hDisplay = hours > 0 ? `${hours < 10 ? '0' + hours : hours}:` : '';
        const mDisplay = minutes < 10 ? '0' + minutes : minutes;
        const sDisplay = seconds < 10 ? '0' + seconds : seconds;

        return `${hDisplay}${mDisplay}:${sDisplay}`;
    }
}

module.exports = PanelBuilder;
