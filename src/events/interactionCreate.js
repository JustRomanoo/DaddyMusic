const { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, Collection, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const PanelBuilder = require('../utils/panelBuilder');

const SPOTIFY_URL_REGEX = /(open\.spotify\.com|spotify:|spotify\.link)/i;
const cooldowns = new Collection();

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit() && !interaction.isRoleSelectMenu()) return;

        try {
            const { client, guildId, member, guild } = interaction;
            const player = client.manager.kazagumo.players.get(guildId);
            const guildConfig = client.guildConfigs.get(guildId);
            const sessionManager = client.sessionManager;

            // 1. Anti-Spam Cooldown
            const cooldownKey = `${interaction.user.id}-${guildId}`;
            if (cooldowns.has(cooldownKey)) {
                return interaction.reply({ content: '⏳ Please wait a moment...', flags: [MessageFlags.Ephemeral] });
            }
        cooldowns.set(cooldownKey, Date.now());
        setTimeout(() => cooldowns.delete(cooldownKey), 800);

        // 2. Global Checks (Voice & VC)
        if (!member.voice.channel) {
            return interaction.reply({ content: '⚠️ You must be in a voice channel!', flags: [MessageFlags.Ephemeral] });
        }
        if (guild.members.me.voice.channelId && member.voice.channelId !== guild.members.me.voice.channelId) {
            return interaction.reply({ content: `⚠️ Join <@${client.user.id}>'s voice channel to interact!`, flags: [MessageFlags.Ephemeral] });
        }

        // 3. Handle Dashboard/Settings
        if (interaction.customId?.startsWith('setting_') || interaction.customId === 'music_settings_open') {
            if (!sessionManager.canManageSettings(member, guildConfig)) {
                return interaction.reply({ content: '❌ Only Moderators or Admins can access settings.', flags: [MessageFlags.Ephemeral] });
            }

            if (interaction.customId === 'music_settings_open') {
                const state = await this.getGuildState(guildId, client);
                return interaction.reply(PanelBuilder.buildSettingsPanel(state));
            }

            if (interaction.customId === 'setting_lock_toggle') {
                const newLock = !guildConfig.isLocked;
                client.guildConfigs.update(guildId, 'isLocked', newLock);
                const state = await this.getGuildState(guildId, client);
                await interaction.update(PanelBuilder.buildSettingsPanel(state));
                return client.manager.updatePanel(guildId);
            }

            if (interaction.isRoleSelectMenu() && interaction.customId === 'setting_dj_role') {
                const roleId = interaction.values[0];
                client.guildConfigs.update(guildId, 'djRoleId', roleId);
                const state = await this.getGuildState(guildId, client);
                await interaction.update(PanelBuilder.buildSettingsPanel(state));
                return client.manager.updatePanel(guildId);
            }

            if (interaction.customId === 'setting_back_to_panel') {
                return interaction.update({ content: '✅ Settings applied.', embeds: [], components: [] });
            }
        }

        // 4. Handle Music Controls
        const isControlAction = interaction.isButton() && interaction.customId !== 'music_leave' && interaction.customId !== 'music_settings_open' && interaction.customId !== 'music_add_modal' && interaction.customId !== 'music_skip'
            || (interaction.isStringSelectMenu() && (interaction.customId === 'music_volume_select' || interaction.customId === 'music_queue_select'));
        
        const isAddAction = interaction.customId === 'music_add_modal' || interaction.customId === 'modal_add_song' || interaction.customId === 'music_playlist_select' || interaction.customId === 'search_result_select' || interaction.customId === 'modal_custom_playlist';

        if (isControlAction && !sessionManager.canControl(member, player, guildConfig)) {
            return interaction.reply({ content: '❌ **Access Denied**: DJ role or Requester status required.', flags: [MessageFlags.Ephemeral] });
        }

        if (isAddAction && !sessionManager.canAddSongs(member, player, guildConfig)) {
            return interaction.reply({ content: '❌ **Session Locked**: Adding songs is currently restricted.', flags: [MessageFlags.Ephemeral] });
        }

        // 5. Button Logic
        if (interaction.isButton()) {
            if (interaction.customId === 'music_add_modal') return this.showAddSongModal(interaction);
            
            if (interaction.customId === 'music_leave') {
                if (!sessionManager.canManageSettings(member, guildConfig)) {
                    return interaction.reply({ content: '❌ Only Moderators or Admins can make the bot leave.', flags: [MessageFlags.Ephemeral] });
                }
                if (player) {
                    player.destroy();
                    client.manager.clearIdleTimeout(guildId);
                }
                // Also explicitly disconnect from the voice channel just in case
                const me = guild.members.me;
                if (me.voice.channel) {
                    me.voice.disconnect();
                }
                
                await interaction.reply({ content: '🚪 Disconnected from the voice channel and cleared the queue.', flags: [MessageFlags.Ephemeral] });
                return client.manager.updatePanel(guildId);
            }

            if (!player) {
                return interaction.reply({ content: '❌ No active player. Add a song to start playback.', flags: [MessageFlags.Ephemeral] });
            }

            switch (interaction.customId) {
                case 'music_play': player.pause(false); break;
                case 'music_pause': player.pause(true); break;
                case 'music_skip':
                    if (sessionManager.canControl(member, player, guildConfig)) {
                        player.skip();
                        await interaction.reply({ content: '⏭ Skipped to the next song!', flags: [MessageFlags.Ephemeral] });
                    } else if (!guildConfig.isLocked) {
                        const requiredVotes = Math.ceil(member.voice.channel.members.filter(m => !m.user.bot).size / 2);
                        if (!player.skipVotes) player.skipVotes = new Set();
                        if (player.skipVotes.has(member.id)) {
                            return interaction.reply({ content: '❌ You already voted to skip!', flags: [MessageFlags.Ephemeral] });
                        }
                        player.skipVotes.add(member.id);
                        if (player.skipVotes.size >= requiredVotes) {
                            player.skip();
                            await interaction.reply({ content: `⏭ **Vote Skip passed!** (${player.skipVotes.size}/${requiredVotes})` });
                        } else {
                            await interaction.reply({ content: `🗳 **Vote Skip:** ${player.skipVotes.size}/${requiredVotes} votes required to skip.` });
                        }
                    } else {
                        return interaction.reply({ content: '❌ **Access Denied**: Session is locked. Only DJs or the Requester can skip.', flags: [MessageFlags.Ephemeral] });
                    }
                    return client.manager.updatePanel(guildId);
                case 'music_shuffle': player.queue.shuffle(); break;
                case 'music_loop':
                    const loops = { none: 'track', track: 'queue', queue: 'none' };
                    player.setLoop(loops[player.loop] || 'none');
                    break;
            }
            await interaction.deferUpdate();
            return client.manager.updatePanel(guildId);
        }

        // 6. Select Menu Logic
        if (interaction.isStringSelectMenu()) {
            const value = interaction.values[0];
            
            if (interaction.customId === 'music_volume_select') {
                if (!player) return interaction.reply({ content: '❌ No active player.', flags: [MessageFlags.Ephemeral] });
                player.setVolume(parseInt(value));
                await interaction.deferUpdate();
                return client.manager.updatePanel(guildId);
            }

            if (interaction.customId === 'music_playlist_select') {
                if (value === 'playlist_custom_url') {
                    return this.showCustomPlaylistModal(interaction);
                }
                
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const result = await client.manager.kazagumo.search(value, { requester: member });
                return this.handleSearchResult(interaction, result);
            }

            if (interaction.customId === 'search_result_select') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const result = await client.manager.kazagumo.search(value, { requester: member });
                return this.handleSearchResult(interaction, result);
            }

            if (interaction.customId === 'music_queue_select') {
                const index = parseInt(value.split('_')[2]) - 1;
                if (!player) return interaction.reply({ content: '❌ No active player.', flags: [MessageFlags.Ephemeral] });
                player.skip(index);
                await interaction.deferUpdate();
                return client.manager.updatePanel(guildId);
            }
        }

        // 7. Modal Logic
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'modal_add_song' || interaction.customId === 'modal_custom_playlist') {
                const rawQuery = interaction.fields.getTextInputValue(interaction.customId === 'modal_add_song' ? 'song_input' : 'playlist_input');
                const query = rawQuery.trim();
                try {
                    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                } catch (err) {
                    console.warn('Could not defer modal reply:', err?.message || err);
                }

                let result = await client.manager.kazagumo.search(query, { requester: member });
                if (!result.tracks.length && SPOTIFY_URL_REGEX.test(query)) {
                    console.warn(`Spotify URL fallback search for query: ${query}`);
                    result = await client.manager.kazagumo.search(query, { requester: member, engine: 'spotify', source: 'spotify' });
                }

                if (!result.tracks.length && SPOTIFY_URL_REGEX.test(query)) {
                    return interaction.editReply('❌ No Spotify tracks were found. This usually means Spotify credentials are missing or invalid in your Render environment. Please verify `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`, then restart the bot.');
                }

                return this.handleSearchResult(interaction, result);
            }
        }
    } catch (error) {
            return this.executeError(interaction, error);
        }
    },

    async executeError(interaction, error) {
        console.error('Interaction error:', error);
        if (!interaction) return;
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: '❌ Something went wrong while processing that action.', flags: [MessageFlags.Ephemeral] });
            } else {
                await interaction.reply({ content: '❌ Something went wrong while processing that action.', flags: [MessageFlags.Ephemeral] });
            }
        } catch (err) {
            console.error('Failed to send error response for interaction:', err);
        }
    },

    /**
     * Centralized search result handler (Supports Playlists, Tracks, and Searches)
     */
    async handleSearchResult(interaction, result) {
        if (!result.tracks.length) return interaction.editReply('❌ No tracks found.');

        const { client, guildId, member } = interaction;

        if (result.type === 'PLAYLIST' || result.type === 'TRACK') {
            for (const track of result.tracks) {
                await this.playTrack(interaction, track, true);
            }
            await client.manager.updatePanel(guildId);
            const message = result.type === 'PLAYLIST' 
                ? `📁 Added playlist: **${result.playlistName}** (${result.tracks.length} tracks)` 
                : `➕ Added: **${result.tracks[0].title}**`;
            return interaction.editReply(message);
        }

        // Search flow
        const top5 = result.tracks.slice(0, 5);
        const menu = new StringSelectMenuBuilder().setCustomId('search_result_select').setPlaceholder('Choose a track...')
            .addOptions(top5.map(t => ({ label: t.title.substring(0, 100), description: t.author.substring(0, 100), value: t.uri })));
        return interaction.editReply({ content: `🔍 Search results:`, components: [new ActionRowBuilder().addComponents(menu)] });
    },

    async getGuildState(guildId, client) {
        const guildConfig = client.guildConfigs.get(guildId);
        const guild = client.guilds.cache.get(guildId);
        const djRole = guildConfig.djRoleId ? guild.roles.cache.get(guildConfig.djRoleId) : null;
        return { isLocked: guildConfig.isLocked, djRoleName: djRole ? djRole.name : 'Not Set' };
    },

    async playTrack(interaction, track, skipUpdate = false) {
        const { client, guildId, member } = interaction;
        let player = client.manager.kazagumo.players.get(guildId);
        if (!player) {
            player = await client.manager.kazagumo.createPlayer({ guildId, textId: interaction.channelId, voiceId: member.voice.channelId, deaf: true });
        }
        player.queue.add(track);
        if (!player.playing && !player.paused) {
            try {
                await player.play();
            } catch (err) {
                console.error('Failed to start playback:', err);
            }
        }
        if (!skipUpdate) await client.manager.updatePanel(guildId);
    },

    async showAddSongModal(interaction) {
        const modal = new ModalBuilder().setCustomId('modal_add_song').setTitle('Add Song to Queue');
        const input = new TextInputBuilder().setCustomId('song_input').setLabel('Search or URL').setPlaceholder('Song name...').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    },

    async showCustomPlaylistModal(interaction) {
        const modal = new ModalBuilder().setCustomId('modal_custom_playlist').setTitle('Load Spotify Playlist');
        const input = new TextInputBuilder().setCustomId('playlist_input').setLabel('Spotify playlist URL').setPlaceholder('https://open.spotify.com/playlist/...').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    }
};
