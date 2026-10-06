const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');

const API_BASE = 'https://v2.rdembed.sbs/api';
const CHANNELS_ENDPOINT = 'https://v2.rdembed.sbs/api/channels/';

const client = axios.create({
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://v2.rdembed.sbs/'
    }
});

function parseStreamUrl(data) {
    if (!data) return null;
    
    if (typeof data === 'object') {
        const candidate = data.url || data.stream_url || data.embed || data.link || data.player || data.iframe || data.m3u8 || data.hls;
        if (candidate) return parseStreamUrl(candidate);
    }

    if (typeof data === 'string') {
        const iframeMatch = data.match(/src=["']([^"']+)["']/i);
        if (iframeMatch && iframeMatch[1]) {
            return iframeMatch[1];
        }
        return data.trim();
    }

    return null;
}

async function getChannels() {
    try {
        const response = await client.get(CHANNELS_ENDPOINT);
        const data = response.data;
        return Array.isArray(data) ? data : (data.channels || data.data || data.results || []);
    } catch (error) {
        console.error('Erro ao procurar canais:', error.message);
        return [];
    }
}

const manifest = {
    id: 'org.rdembed.addon',
    version: '1.2.0',
    name: 'RD Embed - TV & Filmes',
    description: 'Addon de TV ao Vivo, Filmes e Séries integrado com a API RD Embed',
    types: ['tv', 'movie', 'series'],
    catalogs: [
        {
            type: 'tv',
            id: 'rdembed_tv_catalog',
            name: 'RD Embed TV'
        }
    ],
    resources: ['catalog', 'meta', 'stream'],
    idPrefixes: ['rde_', 'tt']
};

const builder = new addonBuilder(manifest);

// 1. Catálogo de Canais
builder.defineCatalogHandler(async ({ type, id }) => {
    if (type === 'tv' && id === 'rdembed_tv_catalog') {
        const channels = await getChannels();
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

// 2. Metadados do Canal
builder.defineMetaHandler(async ({ type, id }) => {
    if (type === 'tv' && id.startsWith('rde_')) {
        const channels = await getChannels();
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

// 3. Resolução de Streams (Canais, Filmes e Séries)
builder.defineStreamHandler(async ({ type, id }) => {
    const streams = [];

    // --- TV AO VIVO ---
    if (type === 'tv' && id.startsWith('rde_')) {
        const channels = await getChannels();
        const cleanId = id.replace('rde_', '');
        const channel = channels.find((c, index) => String(c.id || c.slug || c.code || index) === cleanId);

        if (channel) {
            let streamUrl = parseStreamUrl(channel);

            if (!streamUrl && (channel.id || channel.slug)) {
                try {
                    const subRes = await client.get(`${API_BASE}/channel/${channel.id || channel.slug}`);
                    streamUrl = parseStreamUrl(subRes.data);
                } catch (e) {
                    console.error('Erro na sub-rota do canal:', e.message);
                }
            }

            if (streamUrl) {
                if (streamUrl.includes('.m3u8') || streamUrl.includes('.mp4')) {
                    streams.push({ title: 'Assistir ao Vivo (Direct Stream)', url: streamUrl });
                }
                streams.push({ title: 'Abrir no Player Web', externalUrl: streamUrl });
            }
        }
    }

    // --- FILMES (IMDb ID) ---
    else if (type === 'movie' && id.startsWith('tt')) {
        try {
            const res = await client.get(`${API_BASE}/movie/${id}`);
            const streamUrl = parseStreamUrl(res.data);
            if (streamUrl) {
                streams.push({ title: 'Assistir Filme (RD Embed)', externalUrl: streamUrl });
            }
        } catch (e) {
            console.error(`Erro ao procurar filme ${id}:`, e.message);
        }
    }

    // --- SÉRIES (IMDb ID:temporada:episodio) ---
    else if (type === 'series' && id.startsWith('tt')) {
        const [imdbId, season, episode] = id.split(':');
        try {
            const res = await client.get(`${API_BASE}/series/${imdbId}/${season}/${episode}`);
            const streamUrl = parseStreamUrl(res.data);
            if (streamUrl) {
                streams.push({ title: `Assistir T${season}E${episode}`, externalUrl: streamUrl });
            }
        } catch (e) {
            console.error(`Erro ao procurar série ${id}:`, e.message);
        }
    }

    return { streams };
});

const app = express();

// Rota de teste no navegador
app.get('/test', async (req, res) => {
    try {
        const response = await client.get(CHANNELS_ENDPOINT);
        res.json({
            success: true,
            count: Array.isArray(response.data) ? response.data.length : 'N/A',
            data: response.data
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
            status: err.response ? err.response.status : null
        });
    }
});

const addonInterface = builder.getInterface();
const sdkRouter = getRouter(addonInterface);

app.use('/', sdkRouter);

module.exports = app;
