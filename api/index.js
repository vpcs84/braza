const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');

const API_CHANNELS_URL = 'https://reidosembeds.online/api/channels';

const client = axios.create({
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://reidosembeds.online/'
    }
});

function sanitizeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;

    let clean = rawUrl.trim();

    const iframeMatch = clean.match(/src=["']([^"']+)["']/i);
    if (iframeMatch && iframeMatch[1]) {
        clean = iframeMatch[1].trim();
    }

    clean = clean.replace(/^https?\s*:\s*[\\\/]+/i, (match) => {
        return match.toLowerCase().startsWith('https') ? 'https://' : 'http://';
    });

    clean = clean.replace(/\\/g, '/');
    clean = clean.replace(/\s+/g, '');

    return clean;
}

function parseStreamUrl(data) {
    if (!data) return null;
    
    if (typeof data === 'object') {
        const candidate = data.embed_url || data.url || data.stream_url || data.embed || data.link || data.player || data.iframe || data.m3u8 || data.hls;
        if (candidate) return parseStreamUrl(candidate);
    }

    if (typeof data === 'string') {
        return sanitizeUrl(data);
    }

    return null;
}

async function getChannels() {
    try {
        const response = await client.get(API_CHANNELS_URL);
        const data = response.data;
        return Array.isArray(data) ? data : (data.channels || data.data || data.results || []);
    } catch (error) {
        console.error('Erro ao buscar canais:', error.message);
        return [];
    }
}

const manifest = {
    id: 'org.reidosembeds.tv',
    version: '1.7.0',
    name: 'Rei dos Embeds - TV',
    description: 'Canais de TV ao vivo integrados do Rei dos Embeds em formato Banner',
    types: ['tv'],
    catalogs: [
        {
            type: 'tv',
            id: 'reidosembeds_tv_catalog',
            name: 'Rei dos Embeds TV'
        }
    ],
    resources: ['catalog', 'meta', 'stream'],
    idPrefixes: ['rde_']
};

const builder = new addonBuilder(manifest);

// 1. Catálogo com Formato Banner (Landscape)
builder.defineCatalogHandler(async ({ type, id }) => {
    if (type === 'tv' && id === 'reidosembeds_tv_catalog') {
        const channels = await getChannels();
        const metas = channels.map((item, index) => {
            const channelId = String(item.id || item.slug || item.code || index);
            
            // Prioriza preview_url ou banner para formar o banner horizontal
            const bannerUrl = sanitizeUrl(item.preview_url || item.banner || item.logo_url || item.logo || item.image);

            return {
                id: `rde_${channelId}`,
                type: 'tv',
                name: item.name || item.title || item.nome || `Canal ${index + 1}`,
                poster: bannerUrl || '',
                posterShape: 'landscape', // <--- Formato Banner Horizontal
                description: item.category ? `Categoria: ${item.category}` : 'Canal ao vivo'
            };
        });
        return { metas };
    }
    return { metas: [] };
});

// 2. Metadados detalhados
builder.defineMetaHandler(async ({ type, id }) => {
    if (type === 'tv' && id.startsWith('rde_')) {
        const channels = await getChannels();
        const cleanId = id.replace('rde_', '');
        const channel = channels.find((c, index) => String(c.id || c.slug || c.code || index) === cleanId);

        if (channel) {
            const bannerUrl = sanitizeUrl(channel.preview_url || channel.banner || channel.logo_url || channel.logo);
            const logoUrl = sanitizeUrl(channel.logo_url || channel.logo);

            return {
                meta: {
                    id: id,
                    type: 'tv',
                    name: channel.name || channel.title || channel.nome || 'Canal',
                    poster: bannerUrl || '',
                    posterShape: 'landscape', // Formato Banner
                    background: bannerUrl || '', // Imagem de fundo da tela do canal
                    logo: logoUrl || ''
                }
            };
        }
    }
    return { meta: null };
});

// 3. Streams
builder.defineStreamHandler(async ({ type, id }) => {
    if (type === 'tv' && id.startsWith('rde_')) {
        const channels = await getChannels();
        const cleanId = id.replace('rde_', '');
        const channel = channels.find((c, index) => String(c.id || c.slug || c.code || index) === cleanId);

        if (channel) {
            const streamUrl = parseStreamUrl(channel);

            if (streamUrl) {
                const streams = [];

                if (streamUrl.includes('.m3u8') || streamUrl.includes('.mp4')) {
                    streams.push({
                        title: `Assistir ${channel.name || 'Ao Vivo'} (Direct Stream)`,
                        url: streamUrl
                    });
                }

                streams.push({
                    title: `Abrir no Player Web (${channel.name || 'Ao Vivo'})`,
                    externalUrl: streamUrl
                });

                return { streams };
            }
        }
    }
    return { streams: [] };
});

const app = express();

const addonInterface = builder.getInterface();
const sdkRouter = getRouter(addonInterface);

app.use('/', sdkRouter);

module.exports = app;
