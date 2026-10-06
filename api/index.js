const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');

const API_BASE = 'https://v2.rdembed.sbs/api';

// Configuração do cliente HTTP com cabeçalhos para evitar bloqueios
const client = axios.create({
    baseURL: API_BASE,
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://v2.rdembed.sbs/'
    }
});

// Extrai o URL limpo caso a API devolva uma tag HTML <iframe>
function parseStreamUrl(data) {
    if (!data) return null;
    
    // Se a resposta for um objeto JSON
    if (typeof data === 'object') {
        const candidate = data.url || data.stream_url || data.embed || data.link || data.player || data.iframe || data.m3u8 || data.hls;
        if (candidate) return parseStreamUrl(candidate);
    }

    // Se for uma string
    if (typeof data === 'string') {
        const iframeMatch = data.match(/src=["']([^"']+)["']/i);
        if (iframeMatch && iframeMatch[1]) {
            return iframeMatch[1];
        }
        return data.trim();
    }

    return null;
}

// Procura a lista de canais de TV
async function getChannels() {
    try {
        const response = await client.get('/channels');
        const data = response.data;
        return Array.isArray(data) ? data : (data.channels || data.data || data.results || []);
    } catch (error) {
        console.error('Erro ao procurar canais:', error.message);
        return [];
    }
}

// Configuração do Manifest do Stremio
const manifest = {
    id: 'org.rdembed.addon',
    version: '1.1.0',
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

// 1. Catálogo (Exibe a lista de canais de TV)
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

// 2. Metadados dos Canais
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

    // --- STREAM PARA TV AO VIVO ---
    if (type === 'tv' && id.startsWith('rde_')) {
        const channels = await getChannels();
        const cleanId = id.replace('rde_', '');
        const channel = channels.find((c, index) => String(c.id || c.slug || c.code || index) === cleanId);

        if (channel) {
            let streamUrl = parseStreamUrl(channel);

            // Tenta rota secundária se a lista geral não trouxer o link direto
            if (!streamUrl && (channel.id || channel.slug)) {
                try {
                    const subRes = await client.get(`/channel/${channel.id || channel.slug}`);
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

    // --- STREAM PARA FILMES (IMDb ID ex: tt0111161) ---
    else if (type === 'movie' && id.startsWith('tt')) {
        try {
            const res = await client.get(`/movie/${id}`);
            const streamUrl = parseStreamUrl(res.data);
            if (streamUrl) {
                streams.push({ title: 'Assistir Filme (RD Embed)', externalUrl: streamUrl });
            }
        } catch (e) {
            console.error(`Erro ao procurar filme ${id}:`, e.message);
        }
    }

    // --- STREAM PARA SÉRIES (IMDb ID ex: tt0944947:1:1) ---
    else if (type === 'series' && id.startsWith('tt')) {
        const [imdbId, season, episode] = id.split(':');
        try {
            const res = await client.get(`/series/${imdbId}/${season}/${episode}`);
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

// Rotas de Teste para abrir diretamente no navegador
app.get('/test', async (req, res) => {
    try {
        const response = await client.get('/channels');
        res.json({ success: true, count: Array.isArray(response.data) ? response.data.length : 'N/A', data: response.data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const addonInterface = builder.getInterface();
const sdkRouter = getRouter(addonInterface);

app.use('/', sdkRouter);

module.exports = app;
