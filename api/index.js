const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');

const API_BASE = 'https://reidosembeds.online/api';
const CHANNELS_ENDPOINT = 'https://reidosembeds.online/api/channels';

const client = axios.create({
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://reidosembeds.online/'
    }
});

// Sanitizador robusto para tratar "HTTPS :/\/", "HTTPS:/\/\", espaços extras e barras invertidas
function sanitizeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;

    let clean = rawUrl.trim();

    // Se a API devolver um <iframe>, extrai o src
    const iframeMatch = clean.match(/src=["']([^"']+)["']/i);
    if (iframeMatch && iframeMatch[1]) {
        clean = iframeMatch[1].trim();
    }

    // Corrige prefixos como "HTTPS :/\/", "HTTPS ://", "http :\/\", etc.
    clean = clean.replace(/^https?\s*:\s*[\\\/]+/i, (match) => {
        return match.toLowerCase().startsWith('https') ? 'https://' : 'http://';
    });

    // Converte qualquer barra invertida restante no caminho para barra normal
    clean = clean.replace(/\\/g, '/');

    // Remove espaços em branco que possam ter entrado na URL
    clean = clean.replace(/\s+/g, '');

    return clean;
}

function parseStreamUrl(data) {
    if (!data) return null;
    
    if (typeof data === 'object') {
        const candidate = data.url || data.stream_url || data.embed || data.link || data.player || data.iframe || data.m3u8 || data.hls;
        if (candidate) return parseStreamUrl(candidate);
    }

    if (typeof data === 'string') {
        return sanitizeUrl(data);
    }

    return null;
}

async function getChannels() {
    try {
        const response = await client.get(CHANNELS_ENDPOINT);
        const data = response.data;
        return Array.isArray(data) ? data : (data.channels || data.data || data.results || []);
    } catch (error) {
        console.error('Erro ao buscar canais:', error.message);
        return [];
    }
}

const manifest = {
    id: 'org.reidosembeds.tv',
    version: '1.5.0',
    name: 'Rei dos Embeds - TV & Filmes',
    description: 'Addon de TV ao Vivo, Filmes e Séries integrado com a API Rei dos Embeds',
    types: ['tv', 'movie', 'series'],
    catalogs: [
        {
            type: 'tv',
            id: 'reidosembeds_tv_catalog',
            name: 'Rei dos Embeds TV'
        }
    ],
    resources: ['catalog', 'meta', 'stream'],
    idPrefixes: ['rde_', 'tt']
};

const builder = new addonBuilder(manifest);

// 1. Catálogo
builder.defineCatalogHandler(async ({ type, id }) => {
    if (type === 'tv' && id === 'reidosembeds_tv_catalog') {
        const channels = await getChannels();
        const metas = channels.map((item, index) => {
            const channelId = String(item.id || item.slug || item.code || index);
            return {
                id: `rde_${channelId}`,
                type: 'tv',
                name: item.name || item.title || item.nome || `Canal ${index + 1}`,
                poster: sanitizeUrl(item.logo || item.image || item.poster || item.icon) || '',
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
        const channels = await getChannels();
        const cleanId = id.replace('rde_', '');
        const channel = channels.find((c, index) => String(c.id || c.slug || c.code || index) === cleanId);

        if (channel) {
            return {
                meta: {
                    id: id,
                    type: 'tv',
                    name: channel.name || channel.title || channel.nome || 'Canal',
                    poster: sanitizeUrl(channel.logo || channel.image || channel.poster || channel.icon) || '',
                    posterShape: 'square'
                }
            };
        }
    }
    return { meta: null };
});

// 3. Streams
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

    // --- FILMES ---
    else if (type === 'movie' && id.startsWith('tt')) {
        try {
            const res = await client.get(`${API_BASE}/movie/${id}`);
            const streamUrl = parseStreamUrl(res.data);
            if (streamUrl) {
                streams.push({ title: 'Assistir Filme (Rei dos Embeds)', externalUrl: streamUrl });
            }
        } catch (e) {
            console.error(`Erro ao buscar filme ${id}:`, e.message);
        }
    }

    // --- SÉRIES ---
    else if (type === 'series' && id.startsWith('tt')) {
        const [imdbId, season, episode] = id.split(':');
        try {
            const res = await client.get(`${API_BASE}/series/${imdbId}/${season}/${episode}`);
            const streamUrl = parseStreamUrl(res.data);
            if (streamUrl) {
                streams.push({ title: `Assistir T${season}E${episode}`, externalUrl: streamUrl });
            }
        } catch (e) {
            console.error(`Erro ao buscar série ${id}:`, e.message);
        }
    }

    return { streams };
});

const app = express();

// Rota para testar a correção no navegador
app.get('/test', async (req, res) => {
    try {
        const response = await client.get(CHANNELS_ENDPOINT);
        const rawData = response.data;
        const channels = Array.isArray(rawData) ? rawData : (rawData.channels || rawData.data || []);

        const sampleFixed = channels.slice(0, 3).map(ch => {
            const original = ch.url || ch.embed || ch.link;
            return {
                original: original,
                sanitized: parseStreamUrl(ch)
            };
        });

        res.json({
            success: true,
            total_channels: channels.length,
            sample_tests: sampleFixed
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const addonInterface = builder.getInterface();
const sdkRouter = getRouter(addonInterface);

app.use('/', sdkRouter);

module.exports = app;
