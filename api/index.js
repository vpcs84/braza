const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');

const API_BASE_URL = 'https://reidosembeds.online/api';
const API_CHANNELS_URL = `${API_BASE_URL}/channels`;

async function fetchFromApi(url) {
    try {
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://reidosembeds.online/'
            }
        });
        return { success: true, status: response.status, data: response.data };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            status: error.response ? error.response.status : null,
            data: error.response ? error.response.data : null
        };
    }
}

const manifest = {
    id: 'org.reidosembeds.tv',
    version: '1.0.3',
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

// 1. Catálogo
builder.defineCatalogHandler(async ({ type, id }) => {
    if (type === 'tv' && id === 'reidosembeds_tv_catalog') {
        const res = await fetchFromApi(API_CHANNELS_URL);
        if (!res.success || !res.data) return { metas: [] };

        const channels = Array.isArray(res.data)
            ? res.data
            : (res.data.channels || res.data.data || res.data.results || []);

        const metas = channels.map((item, index) => {
            const channelId = String(item.id || item.slug || item.code || index);
            return {
                id: `rde_${channelId}`,
                type: 'tv',
                name: item.name || item.title || item.nome || `Canal ${index + 1}`,
                poster: item.logo || item.image || item.poster || item.icon || '',
                posterShape: 'square',
                description: item.category ? `Categoria: ${item.category}` : 'Canal ao vivo'
            };
        });
        return { metas };
    }
    return { metas: [] };
});

// 2. Metadados
builder.defineMetaHandler(async ({ type, id }) => {
    if (type === 'tv' && id.startsWith('rde_')) {
        const res = await fetchFromApi(API_CHANNELS_URL);
        if (!res.success || !res.data) return { meta: null };

        const channels = Array.isArray(res.data)
            ? res.data
            : (res.data.channels || res.data.data || res.data.results || []);

        const cleanId = id.replace('rde_', '');
        const channel = channels.find((c, index) => String(c.id || c.slug || c.code || index) === cleanId);

        if (channel) {
            return {
                meta: {
                    id: id,
                    type: 'tv',
                    name: channel.name || channel.title || channel.nome || 'Canal',
                    poster: channel.logo || channel.image || channel.poster || channel.icon || '',
                    posterShape: 'square'
                }
            };
        }
    }
    return { meta: null };
});

// 3. Streams
builder.defineStreamHandler(async ({ type, id }) => {
    if (type === 'tv' && id.startsWith('rde_')) {
        const res = await fetchFromApi(API_CHANNELS_URL);
        if (!res.success || !res.data) return { streams: [] };

        const channels = Array.isArray(res.data)
            ? res.data
            : (res.data.channels || res.data.data || res.data.results || []);

        const cleanId = id.replace('rde_', '');
        const channel = channels.find((c, index) => String(c.id || c.slug || c.code || index) === cleanId);

        if (channel) {
            // Se o canal necessitar de uma chamada adicional para obter a stream individual
            let rawUrl = channel.url || channel.stream_url || channel.embed || channel.link || channel.player || channel.iframe || channel.hls || channel.m3u8;

            // Se a API exigir chamada no formato GET /api/channel/:id ou similar
            if (!rawUrl && (channel.id || channel.slug)) {
                const subRes = await fetchFromApi(`${API_BASE_URL}/channel/${channel.id || channel.slug}`);
                if (subRes.success && subRes.data) {
                    rawUrl = subRes.data.url || subRes.data.embed || subRes.data.link || subRes.data.stream;
                }
            }

            if (rawUrl) {
                return {
                    streams: [
                        {
                            title: `Assistir ${channel.name || 'Ao Vivo'}`,
                            url: rawUrl
                        },
                        {
                            title: `Abrir no Navegador / Web`,
                            externalUrl: rawUrl
                        }
                    ]
                };
            }
        }
    }
    return { streams: [] };
});

const app = express();

// Rotas de Depuração Direta (Para abrir no browser)
app.get('/test', async (req, res) => {
    const apiBase = await fetchFromApi(API_BASE_URL);
    res.json(apiBase);
});

app.get('/debug-channels', async (req, res) => {
    const channels = await fetchFromApi(API_CHANNELS_URL);
    res.json(channels);
});

const addonInterface = builder.getInterface();
const sdkRouter = getRouter(addonInterface);

app.use('/', sdkRouter);

module.exports = app;
