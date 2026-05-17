const { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, Collection, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const PanelBuilder = require('../utils/panelBuilder');

const SPOTIFY_URL_REGEX = /(open\.spotify\.com|spotify:|spotify\.link)/i;
const YOUTUBE_URL_REGEX = /(youtube\.com|youtu\.be)/i;
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
                const result = await this.safeSearch(client.manager.kazagumo, value, { requester: member, engine: 'youtube' });
                return this.handleSearchResult(interaction, result);
            }

            if (interaction.customId === 'search_result_select') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const result = await this.safeSearch(client.manager.kazagumo, value, { requester: member });
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

                const kazagumo = client.manager.kazagumo;
                const isSpotify = SPOTIFY_URL_REGEX.test(query);
                const isYoutubeUrl = YOUTUBE_URL_REGEX.test(query);
                const isUrl = /^https?:\/\//.test(query);

                console.log(`[Search] Query: "${query}" | Spotify: ${isSpotify} | YouTube URL: ${isYoutubeUrl} | IsURL: ${isUrl}`);

                let result = null;
                let attempts = [];

                if (isSpotify) {
                    // For Spotify URLs, rely on the Spotify plugin which intercepts search()
                    result = await this.safeSearch(kazagumo, query, { requester: member, engine: 'youtube' });
                    attempts.push({ engine: 'spotify_plugin', tracks: result?.tracks?.length ?? 0, type: result?.type });

                    if (!result?.tracks?.length) {
                        console.log(`[Search] Spotify plugin returned empty. Trying direct Spotify API + YouTube fallback...`);
                        const textQuery = await this.resolveSpotifyUrl(query);
                        if (textQuery) {
                            console.log(`[Search] Fallback: searching youtube for "${textQuery}"`);
                            const fallback = await this.safeSearch(kazagumo, textQuery, { requester: member, engine: 'youtube' });
                            attempts.push({ engine: 'spotify_api_text', tracks: fallback?.tracks?.length ?? 0, type: fallback?.type });
                            if (fallback?.tracks?.length) result = fallback;
                        }
                    }
                } else if (isYoutubeUrl || isUrl) {
                    // YouTube or other URL — pass directly to Lavalink
                    result = await this.safeSearch(kazagumo, query, { requester: member });
                    attempts.push({ engine: 'url_direct', tracks: result?.tracks?.length ?? 0, type: result?.type });

                    if (!result?.tracks?.length) {
                        console.log(`[Search] URL search returned empty, trying youtube text search...`);
                        const textQuery = this.extractYoutubeSearchQuery(query);
                        if (textQuery) {
                            const fallback = await this.safeSearch(kazagumo, textQuery, { requester: member, engine: 'youtube' });
                            attempts.push({ engine: 'youtube_text', tracks: fallback?.tracks?.length ?? 0, type: fallback?.type });
                            if (fallback?.tracks?.length) result = fallback;
                        }
                    }
                } else {
                    // Plain text search
                    result = await this.safeSearch(kazagumo, query, { requester: member, engine: 'youtube' });
                    attempts.push({ engine: 'youtube', tracks: result?.tracks?.length ?? 0, type: result?.type });

                    if (!result?.tracks?.length) {
                        // Retry with different engine
                        console.log(`[Search] youtube engine returned empty, trying youtube_music...`);
                        const fallback = await this.safeSearch(kazagumo, query, { requester: member, engine: 'youtube_music' });
                        attempts.push({ engine: 'youtube_music', tracks: fallback?.tracks?.length ?? 0, type: fallback?.type });
                        if (fallback?.tracks?.length) result = fallback;
                    }

                    if (!result?.tracks?.length) {
                        // Retry with soundcloud
                        console.log(`[Search] youtube failed, trying soundcloud...`);
                        const fallback = await this.safeSearch(kazagumo, query, { requester: member, engine: 'soundcloud' });
                        attempts.push({ engine: 'soundcloud', tracks: fallback?.tracks?.length ?? 0, type: fallback?.type });
                        if (fallback?.tracks?.length) result = fallback;
                    }
                }

                // Log all attempts for debugging
                console.log(`[Search] Attempts summary:`, JSON.stringify(attempts));

                if (!result || !result.tracks || !result.tracks.length) {
                    const attemptLog = attempts.map(a => `${a.engine}:${a.tracks}`).join(', ');
                    let message = '❌ No tracks found.';
                    if (isSpotify) {
                        message = '❌ Could not find any playable tracks for this Spotify URL. Try searching by song name instead.';
                    }
                    console.log(`[Search] All attempts failed. ${attemptLog}`);
                    return interaction.editReply(message);
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
            const msg = '❌ Something went wrong while processing that action.';
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: msg, flags: [MessageFlags.Ephemeral] });
            } else {
                await interaction.reply({ content: msg, flags: [MessageFlags.Ephemeral] });
            }
        } catch (err) {
            console.error('Failed to send error response for interaction:', err);
        }
    },

    /**
     * Safely call kazagumo.search() with error logging
     */
    async safeSearch(kazagumo, query, options) {
        try {
            const result = await kazagumo.search(query, options);
            console.log(`[Search] Result for "${query.substring(0, 80)}": type=${result?.type}, tracks=${result?.tracks?.length}${result?.playlistName ? `, playlist="${result.playlistName}"` : ''}`);
            return result;
        } catch (err) {
            console.error(`[Search] Error searching "${query.substring(0, 80)}":`, err?.message || err);
            return null;
        }
    },

    /**
     * Resolve a Spotify URL by calling the Spotify API directly, returning "Artist - Title"
     * Used as a fallback when the kazagumo-spotify plugin returns empty.
     */
    async resolveSpotifyUrl(query) {
        const config = require('../config');
        const { clientId, clientSecret } = config.spotify;
        if (!clientId || !clientSecret) return null;

        try {
            // Get Spotify API token
            const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
            const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'grant_type=client_credentials'
            });
            const tokenBody = await tokenRes.json();
            if (!tokenBody.access_token) return null;
            const token = `Bearer ${tokenBody.access_token}`;

            // Track URL: https://open.spotify.com/track/{id}
            const trackMatch = query.match(/track\/([A-Za-z0-9]+)/);
            if (trackMatch) {
                const trackRes = await fetch(`https://api.spotify.com/v1/tracks/${trackMatch[1]}`, {
                    headers: { Authorization: token }
                });
                if (!trackRes.ok) return null;
                const track = await trackRes.json();
                const artist = track.artists?.[0]?.name;
                const title = track.name;
                if (artist && title) {
                    const textQuery = `${artist} - ${title}`;
                    console.log(`[Spotify] Resolved track: "${textQuery}"`);
                    return textQuery;
                }
                return null;
            }

            // Playlist URL: https://open.spotify.com/playlist/{id}
            const playlistMatch = query.match(/playlist\/([A-Za-z0-9]+)/);
            if (playlistMatch) {
                console.log(`[Spotify] Playlists cannot be resolved via text fallback. Returning null.`);
                return null; // Can't convert a whole playlist to a single text query
            }

            return null;
        } catch (err) {
            console.error(`[Spotify] API fallback error:`, err?.message || err);
            return null;
        }
    },

    /**
     * Extract a search query from a YouTube URL
     */
    extractYoutubeSearchQuery(query) {
        try {
            const url = new URL(query);
            if (url.hostname.includes('youtube.com')) {
                const params = new URLSearchParams(url.search);
                const v = params.get('v');
                if (v) return v;
                const list = params.get('list');
                if (list) return list;
            }
        } catch {
            // Not a valid URL
        }
        return null;
    },

    /**
     * Centralized search result handler (Supports Playlists, Tracks, and Searches)
     */
    async handleSearchResult(interaction, result) {
        if (!result || !result.tracks || !result.tracks.length) {
            return interaction.editReply('❌ No tracks found.');
        }

        const { client, guildId, member } = interaction;

        if (result.type === 'PLAYLIST' || result.type === 'TRACK') {
            for (const track of result.tracks) {
                await this.playTrack(interaction, track, true);
            }
            await client.manager.updatePanel(guildId);
            const message = result.type === 'PLAYLIST'
                ? `📁 Added playlist: **${result.playlistName || 'Untitled'}** (${result.tracks.length} tracks)`
                : `➕ Added: **${result.tracks[0].title || 'Unknown'}**`;
            return interaction.editReply(message);
        }

        // Search flow (SEARCH type or unknown type)
        const top5 = result.tracks.slice(0, 5);
        if (!top5.length) {
            return interaction.editReply('❌ No tracks found.');
        }
        const menu = new StringSelectMenuBuilder().setCustomId('search_result_select').setPlaceholder('Choose a track...')
            .addOptions(top5.map(t => ({
                label: (t.title || 'Unknown').substring(0, 100),
                description: (t.author || 'Unknown').substring(0, 100),
                value: t.uri || t.identifier
            })));
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
        try {
            const modal = new ModalBuilder().setCustomId('modal_add_song').setTitle('Add Song to Queue');
            const input = new TextInputBuilder().setCustomId('song_input').setLabel('Search or URL').setPlaceholder('Song name, YouTube URL, or Spotify URL...').setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        } catch (err) {
            console.error('Failed to show add song modal:', err?.message || err);
        }
    },

    async showCustomPlaylistModal(interaction) {
        try {
            const modal = new ModalBuilder().setCustomId('modal_custom_playlist').setTitle('Load Playlist URL');
            const input = new TextInputBuilder().setCustomId('playlist_input').setLabel('Playlist URL').setPlaceholder('https://open.spotify.com/playlist/... or YouTube playlist URL').setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        } catch (err) {
            console.error('Failed to show custom playlist modal:', err?.message || err);
        }
    }
};
