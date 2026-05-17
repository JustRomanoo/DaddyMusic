require('dotenv').config();

function getLavalinkConfig() {
    const rawUrl = process.env.LAVALINK_URL?.trim();
    const host = process.env.LAVALINK_HOST?.trim();
    const port = process.env.LAVALINK_PORT?.trim();

    const hasProtocol = (value) => /^(https?:\/\/|wss?:\/\/)/i.test(value || '');
    const isSecureProtocol = (value) => /^(https:\/\/|wss:\/\/)/i.test(value || '');
    const stripProtocol = (value) => value?.replace(/^(?:https?:\/\/|wss?:\/\/)/i, '').replace(/\/+$/, '');

    // If LAVALINK_SECURE is explicitly set, use it
    const explicitSecure = process.env.LAVALINK_SECURE?.trim();
    if (explicitSecure !== undefined && explicitSecure !== '') {
        return {
            url: rawUrl ? stripProtocol(rawUrl) : (host && port ? `${stripProtocol(host)}:${port}` : null),
            secure: explicitSecure.toLowerCase() === 'true'
        };
    }

    // Auto-detect from URL protocol
    if (rawUrl && hasProtocol(rawUrl)) {
        return {
            url: stripProtocol(rawUrl),
            secure: isSecureProtocol(rawUrl)
        };
    }

    if (host && hasProtocol(host)) {
        return {
            url: port ? `${stripProtocol(host)}:${port}` : stripProtocol(host),
            secure: isSecureProtocol(host)
        };
    }

    // Default: secure if port is 443, otherwise false
    const isDefaultSecure = port === '443';
    if (isDefaultSecure) {
        console.log('🔒 Port 443 detected, defaulting to secure connection (wss://)');
    }

    if (rawUrl) {
        return { url: stripProtocol(rawUrl), secure: isDefaultSecure };
    }

    if (!host || !port) {
        return { url: null, secure: false };
    }

    return { url: `${stripProtocol(host)}:${port}`, secure: isDefaultSecure };
}

const lavalinkConfig = getLavalinkConfig();

if (!lavalinkConfig.url) {
    console.error('❌ ERROR: Lavalink host/port is not configured correctly. Check LAVALINK_HOST, LAVALINK_PORT, or LAVALINK_URL in your .env.');
}

module.exports = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    prefix: process.env.PREFIX || '!',
    spotify: {
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET
    },
    colors: {
        primary: '#5865F2', // Blurple
        success: '#57F287', // Green
        danger: '#ED4245',  // Red
        warning: '#FEE75C'  // Yellow
    },
    playlists: [
        { label: 'Top Hits 2024', value: 'playlist_top_hits', description: 'The most popular songs right now' },
        { label: 'Lofi Chill', value: 'playlist_lofi', description: 'Relaxing beats for studying' },
        { label: 'Rock Classics', value: 'playlist_rock', description: 'Legendary rock anthems' }
    ],
    nodes: [
        {
            name: 'Primary (from env)',
            url: lavalinkConfig.url,
            auth: process.env.LAVALINK_PASS?.trim() || 'https://discord.gg/v6sdrD9kPh',
            secure: lavalinkConfig.secure
        },
        {
            name: 'Muzykant v4',
            url: 'lavalink_v4.muzykant.xyz:443',
            auth: 'https://discord.gg/v6sdrD9kPh',
            secure: true
        },
        {
            name: 'AjieDev v4',
            url: 'lava-v4.ajieblogs.eu.org:443',
            auth: 'https://dsc.gg/ajidevserver',
            secure: true
        },
        {
            name: 'Disutils Lavalink 1',
            url: 'lavalink-1.is-it.pink:443',
            auth: 'https://disutils.com',
            secure: true
        }
    ]
};
