const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');

const API_CHANNELS_URL = 'https://reidosembeds.online/api/channels';

async function fetchChannels() {
    try {
        const response = await axios.get(API_CHANNELS_URL, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        });

        // Garante a leitura correta do array
        const data = Array.isArray(response.data)
            ? response.data
            : (response.data.channels || response.data.data || response.data.results || []);

        return data;
    } catch (error) {
        console.error('Erro ao procurar canais na API:', error.message);
        return [];
    }
}

const manifest = {
    id: 'org.reidosembeds.tv',
    version: '1.0.1',
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
        
        const metas = channels.map((item, index) => {
            const channelId = String(item.id || item.slug || item.code || index);
            return {
                id: `rde_channel_${channelId}`,
                type: 'tv',
                name: item.name || item.title || item.nome || 'Canal sem nome',
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
    if (type === 'tv' && id.startsWith('rde_channel_')) {
        const channels = await fetchChannels();
        const cleanId = id.replace('rde_channel_', '');

        const channel = channels.find((c, index) => {
            const cId = String(c.id || c.slug || c.code || index);
            return cId === cleanId;
        });

        if (channel) {
            return {
                meta: {
                    id: id,
                    type: 'tv',
                    name: channel.name || channel.title || channel.nome || 'Canal',
                    poster: channel.logo || channel.image || channel.poster || channel.icon || '',
                    posterShape: 'square',
                    description: channel.category ? `Categoria: ${channel.category}` : 'Transmissão ao vivo'
                }
            };
        }
    }
    return { meta: null };
});

// 3. Obtenção do Link de Reprodução
builder.defineStreamHandler(async ({ type, id }) => {
    if (type === 'tv' && id.startsWith('rde_channel_')) {
        const channels = await fetchChannels();
        const cleanId = id.replace('rde_channel_', '');

        const channel = channels.find((c, index) => {
            const cId = String(c.id || c.slug || c.code || index);
            return cId === cleanId;
        });

        if (channel) {
            //Procura o link em qualquer propriedade comum de APIs de streaming
            const streamUrl = channel.url || channel.stream_url || channel.embed || channel.link || channel.player || channel.iframe || channel.hls || channel.m3u8;

            if (streamUrl) {
                const streams = [];

                // Tenta enviar o link direto para o player do Stremio
                streams.push({
                    title: channel.name ? `Assistir ${channel.name}` : 'Assistir ao Vivo',
                    url: streamUrl
                });

                // Opção alternativa caso seja uma página web externa/embed
                if (typeof streamUrl === 'string' && (streamUrl.includes('http://') || streamUrl.includes('https://'))) {
                    streams.push({
                        title: 'Abrir no Player Externo / Web',
                        externalUrl: streamUrl
                    });
                }

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
