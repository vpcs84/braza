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

// Sanitizador de URLs (corrige "HTTPS :/\/", barras invertidas e espaços extras)
function sanitizeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;

    let clean = rawUrl.trim();

    // Extrai o src caso venha numa tag <iframe>
    const iframeMatch = clean.match(/src=["']([^"']+)["']/i);
    if (iframeMatch && iframeMatch[1]) {
        clean = iframeMatch[1].trim();
    }

    // Corrige prefixos como "HTTPS :/\/", "HTTPS ://", "http :\/\", etc.
    clean = clean.replace(/^https?\s*:\s*[\\\/]+/i, (match) => {
        return match.toLowerCase().startsWith('https') ? 'https://' : 'http://';
    });

    // Converte barras invertidas no caminho para barras normais
    clean = clean.replace(/\\/g, '/');

    // Remove espaços em branco
    clean = clean.replace(/\s+/g, '');

    return clean;
}

// Extrai e limpa a URL do stream com foco no campo `embed_url`
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
        console.error('Erro ao procurar canais:', error.message);
        return [];
    }
}

const manifest = {
    id: 'org.reidosembeds.tv',
    version: '1.6.0',
    name: 'Rei dos Embeds - TV',
    description: 'Canais de TV ao vivo integrados do Rei dos Embeds',
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

// 1. Catálogo de Canais
builder.defineCatalogHandler(async ({ type, id }) => {
    if (type === 'tv' && id === 'reidosembeds_tv_catalog') {
        const channels = await getChannels();
        const metas = channels.map((item, index) => {
            const channelId = String(item.id || item.slug || item.code || index);
            const posterUrl = sanitizeUrl(item.logo_url || item.logo || item.preview_url || item.image || item.poster);
            
            return {
                id: `rde_${channelId}`,
                type: 'tv',
                name: item.name || item.title || item.nome || `Canal ${index + 1}`,
                poster: posterUrl || '',
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
            const posterUrl = sanitizeUrl(channel.logo_url || channel.logo || channel.preview_url || channel.image || channel.poster);
            return {
                meta: {
                    id: id,
                    type: 'tv',
                    name: channel.name || channel.title || channel.nome || 'Canal',
                    poster: posterUrl || '',
                    posterShape: 'square'
                }
            };
        }
    }
    return { meta: null };
});

// 3. Resolução de Streams
builder.defineStreamHandler(async ({ type, id }) => {
    if (type === 'tv' && id.startsWith('rde_')) {
        const channels = await getChannels();
        const cleanId = id.replace('rde_', '');
        const channel = channels.find((c, index) => String(c.id || c.slug || c.code || index) === cleanId);

        if (channel) {
            const streamUrl = parseStreamUrl(channel);

            if (streamUrl) {
                const streams = [];

                // Se for link direto (.m3u8 / .mp4)
                if (streamUrl.includes('.m3u8') || streamUrl.includes('.mp4')) {
                    streams.push({
                        title: `Assistir ${channel.name || 'Ao Vivo'} (Direct Stream)`,
                        url: streamUrl
                    });
                }

                // Link Embed para abrir no leitor web
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

// Rota de teste para ver o sanitizador a funcionar
app.get('/test', async (req, res) => {
    try {
        const response = await client.get(API_CHANNELS_URL);
        const channels = Array.isArray(response.data) ? response.data : (response.data.channels || []);

        const sample = channels.slice(0, 3).map(ch => ({
            original_logo: ch.logo_url,
            sanitized_logo: sanitizeUrl(ch.logo_url),
            original_embed: ch.embed_url,
            sanitized_embed: parseStreamUrl(ch)
        }));

        res.json({
            success: true,
            total_channels: channels.length,
            sample
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const addonInterface = builder.getInterface();
const sdkRouter = getRouter(addonInterface);

app.use('/', sdkRouter);

module.exports = app;
