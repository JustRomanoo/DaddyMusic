const { Kazagumo } = require('kazagumo');
const { Connectors } = require('shoukaku');
const { ActivityType } = require('discord.js');
const config = require('../config');
const PanelBuilder = require('./panelBuilder');
const Spotify = require('kazagumo-spotify');

class PlayerManager {
    constructor(client) {
        this.client = client;
        this.idleTimeouts = new Map();
        this.kazagumo = new Kazagumo({
            defaultSearchEngine: 'youtube',
            plugins: [
                new Spotify({
                    clientId: config.spotify.clientId,
                    clientSecret: config.spotify.clientSecret,
                    playlistPageLimit: 5,
                    albumPageLimit: 5,
                    searchLimit: 10,
                    searchMarket: 'US'
                })
            ],
            send: (guildId, payload) => {
                const guild = client.guilds.cache.get(guildId);
                if (guild) guild.shard.send(payload);
            }
        }, new Connectors.DiscordJS(client), config.nodes, {
            resume: true,
            resumeTimeout: 30,
            reconnectTries: 5,
            reconnectInterval: 5,
            moveOnDisconnect: true,
            restTimeout: 30,
            voiceConnectionTimeout: 30
        });

        this.initEvents();
        this.validateSpotifyCredentials();
        
        // Interval for live panel updates (progress bar)
        setInterval(() => this.autoUpdatePanels(), 10000);
    }

    async validateSpotifyCredentials() {
        const { clientId, clientSecret } = config.spotify;
        if (!clientId || !clientSecret) {
            console.warn('⚠️ Spotify credentials are missing. Spotify playlist loading will likely fail.');
            return;
        }

        try {
            const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
            const response = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'grant_type=client_credentials'
            });
            const body = await response.json();
            if (!body.access_token) {
                throw new Error(`Invalid Spotify credentials: ${JSON.stringify(body)}`);
            }
            console.log('✅ Spotify credentials validated successfully.');
        } catch (err) {
            console.error('❌ Spotify credentials validation failed. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in Render or .env.', err);
        }
    }

    initEvents() {
        this.kazagumo.shoukaku.on('ready', (name) => console.log(`✅ Lavalink Node "${name}" is ready!`));
        this.kazagumo.shoukaku.on('error', (name, error) => {
            const nodeConfig = config.nodes.find((node) => node.name === name);
            console.error(`❌ Lavalink Node "${name}" error:`, {
                url: nodeConfig?.url,
                secure: nodeConfig?.secure,
                authConfigured: Boolean(nodeConfig?.auth)
            }, error);
        });

        this.kazagumo.shoukaku.on('disconnect', (name, count) => {
            console.warn(`⚠️ Lavalink Node "${name}" disconnected. Moved ${count} players.`);
        });

        this.kazagumo.on('debug', (message) => {
            if (message.includes('Searched') || message.includes('Resolving') || message.includes('error')) {
                console.log(`[Kazagumo Debug] ${message}`);
            }
        });

        this.kazagumo.on('playerStart', async (player, track) => {
            player.skipVotes = new Set();
            this.clearIdleTimeout(player.guildId);
            this.updatePanel(player.guildId);

            try {
                await this.client.user.setPresence({
                    activities: [{
                        name: `Now Playing ${track.title}`.substring(0, 128),
                        type: ActivityType.Listening
                    }],
                    status: 'online'
                });
            } catch (err) {
                console.log('Failed to update bot presence for now playing.');
            }
        });

        this.kazagumo.on('playerEnd', (player) => {
            this.updatePanel(player.guildId);
        });

        this.kazagumo.on('queueEmpty', async (player) => {
            this.updatePanel(player.guildId);
            this.startIdleTimeout(player);

            try {
                await this.client.user.setPresence({ activities: [] });
            } catch (err) {
                console.log('Failed to clear bot presence after queue empty.');
            }
        });

        this.kazagumo.on('playerPause', (player) => this.updatePanel(player.guildId));
        this.kazagumo.on('playerResume', (player) => this.updatePanel(player.guildId));
        this.kazagumo.on('playerStuck', (player, data) => {
            console.warn('⚠️ Player stuck:', data);
            if (player && player.queue.current) {
                player.play().catch((err) => console.error('Failed to recover stuck player:', err));
            }
        });
        this.kazagumo.on('playerException', (player, error) => {
            console.warn('⚠️ Player exception:', error);
            if (player && player.queue.current) {
                player.play().catch((err) => console.error('Failed to recover player after exception:', err));
            }
        });
    }

    autoUpdatePanels() {
        if (!this.client.activePanels) return;
        for (const guildId of this.client.activePanels.keys()) {
            this.updatePanel(guildId);
        }
    }

    clearIdleTimeout(guildId) {
        const timeout = this.idleTimeouts.get(guildId);
        if (timeout) {
            clearTimeout(timeout);
            this.idleTimeouts.delete(guildId);
        }
    }

    startIdleTimeout(player) {
        this.clearIdleTimeout(player.guildId);
        const timeout = setTimeout(async () => {
            const currentPlayer = this.kazagumo.players.get(player.guildId);
            if (!currentPlayer || currentPlayer.queue.current) {
                this.clearIdleTimeout(player.guildId);
                return;
            }

            try {
                currentPlayer.destroy();
            } catch (err) {
                console.error('Failed to destroy idle player:', err);
            }
            this.clearIdleTimeout(player.guildId);
            this.client.manager.updatePanel(player.guildId);
        }, 120000);

        this.idleTimeouts.set(player.guildId, timeout);
    }

    async updatePanel(guildId) {
        const player = this.kazagumo.players.get(guildId);
        const panelInfo = this.client.activePanels?.get(guildId);
        if (!panelInfo) return;

        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;

        const guildConfig = this.client.guildConfigs.get(guildId);
        const djRole = guildConfig.djRoleId ? guild.roles.cache.get(guildConfig.djRoleId) : null;

        try {
            const channel = await this.client.channels.fetch(panelInfo.channelId);
            const message = await channel.messages.fetch(panelInfo.messageId);

            const loopModes = { none: 'Off', track: 'Song', queue: 'Queue' };
            
            // Format queue with requesters
            const queueList = player?.queue.map((t, i) => {
                const req = t.requester ? `(by <@${t.requester.id}>)` : '';
                return `${i + 1}. ${t.title} ${req}`;
            }) || [];

            const state = {
                currentSong: player?.queue.current?.title || 'None',
                queue: queueList,
                isPaused: player?.paused || false,
                loopMode: loopModes[player?.loop] || 'Off',
                position: player?.position || 0,
                duration: player?.queue.current?.length || 0,
                requester: player?.queue.current?.requester ? `<@${player.queue.current.requester.id}>` : 'None',
                thumbnail: player?.queue.current?.thumbnail || this.client.user.displayAvatarURL({ size: 512, extension: 'png' }),
                volume: player?.volume || 100,
                isLocked: guildConfig.isLocked,
                djRoleName: djRole ? djRole.name : 'Not Set',
                hasPlayer: Boolean(player),
                hasQueue: Boolean(player?.queue.length)
            };

            const embed = PanelBuilder.buildEmbed(state);
            const components = PanelBuilder.buildComponents(state);

            await message.edit({ embeds: [embed], components });
        } catch (err) {
            if (err.code === 10008) this.client.activePanels.delete(guildId);
        }
    }
}

module.exports = PlayerManager;
