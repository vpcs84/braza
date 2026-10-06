const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');

const API_CHANNELS_URL = 'https://reidosembeds.online/api/channels';

// Cache simples em memória (5 minutos)
let channelsCache = [];
let lastFetchTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000;

async function fetchChannels() {
    const now = Date.now();
    if (channelsCache.length > 0 && (now - lastFetchTimestamp) < CACHE_DURATION) {
        return channelsCache;
    }

    try {
        const response = await axios.get(API_CHANNELS_URL, { timeout: 10000 });
        const data = Array.isArray(response.data)
            ? response.data
            : (response.data.channels || response.data.data || []);

        channelsCache = data;
        lastFetchTimestamp = now;
        return channelsCache;
    } catch (error) {
        console.error('Erro ao buscar canais:', error.message);
        return channelsCache;
    }
}

const manifest = {
    id: 'org.reidosembeds.tv',
    version: '1.0.0',
    name: 'Rei dos Embeds - TV Ao Vivo',
    description: 'Canais de TV ao vivo integrados do Rei dos Embeds',
    types: ['tv'],
    catalogs: [
        {
            type: 'tv',
            id: 'reidosembeds_tv_catalog',
            name: 'Rei dos Embeds TV'
        }
    ],
    resources: ['catalog', 'meta', 'stream']
};

const builder = new addonBuilder(manifest);

// 1. Catálogo de Canais
builder.defineCatalogHandler(async ({ type, id }) => {
    if (type === 'tv' && id === 'reidosembeds_tv_catalog') {
        const channels = await fetchChannels();
        const metas = channels.map(item => ({
            id: `rde_channel_${item.id || item.slug || item.name}`,
            type: 'tv',
            name: item.name || item.title || 'Canal',
            poster: item.logo || item.image || item.poster || '',
            posterShape: 'square',
            description: item.category ? `Categoria: ${item.category}` : 'Canal ao vivo'
        }));
        return { metas };
    }
    return { metas: [] };
});

// 2. Metadados do Canal
builder.defineMetaHandler(async ({ type, id }) => {
    if (type === 'tv' && id.startsWith('rde_channel_')) {
        const channels = await fetchChannels();
        const channelId = id.replace('rde_channel_', '');
        const channel = channels.find(c => String(c.id || c.slug || c.name) === channelId);

        if (channel) {
            return {
                meta: {
                    id: id,
                    type: 'tv',
                    name: channel.name || channel.title,
                    poster: channel.logo || channel.image || channel.poster || '',
                    posterShape: 'square',
                    description: channel.category ? `Categoria: ${channel.category}` : 'Transmissão ao vivo'
                }
            };
        }
    }
    return { meta: null };
});

// 3. Link da Stream
builder.defineStreamHandler(async ({ type, id }) => {
    if (type === 'tv' && id.startsWith('rde_channel_')) {
        const channels = await fetchChannels();
        const channelId = id.replace('rde_channel_', '');
        const channel = channels.find(c => String(c.id || c.slug || c.name) === channelId);

        if (channel) {
            const streamUrl = channel.url || channel.stream_url || channel.embed;
            if (streamUrl) {
                const isDirectMedia = streamUrl.includes('.m3u8') || streamUrl.includes('.mp4');
                return {
                    streams: [
                        {
                            title: channel.name ? `Assistir ${channel.name}` : 'Assistir ao Vivo',
                            [isDirectMedia ? 'url' : 'externalUrl']: streamUrl
                        }
                    ]
                };
            }
        }
    }
    return { streams: [] };
});

// Inicialização Express para Serverless
const app = express();
const addonInterface = builder.getInterface();
const sdkRouter = getRouter(addonInterface);

app.use('/', sdkRouter);

module.exports = app;
