require('dotenv').config();

function normalizeLavalinkUrl() {
    const rawUrl = process.env.LAVALINK_URL?.trim();
    const host = process.env.LAVALINK_HOST?.trim();
    const port = process.env.LAVALINK_PORT?.trim();

    const stripProtocol = (value) => value?.replace(/^(?:https?:\/\/|wss?:\/\/)/i, '').replace(/\/+$/, '');

    if (rawUrl) {
        return stripProtocol(rawUrl);
    }

    if (!host || !port) {
        return null;
    }

    const normalizedHost = stripProtocol(host).replace(/\/$/, '');
    return `${normalizedHost}:${port}`;
}

const lavalinkUrl = normalizeLavalinkUrl();
const lavalinkSecure = String(process.env.LAVALINK_SECURE || '').trim().toLowerCase() === 'true';

if (!lavalinkUrl) {
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
            name: 'Local Node',
            url: lavalinkUrl,
            auth: process.env.LAVALINK_PASS?.trim(),
            secure: lavalinkSecure
        }
    ]
};
