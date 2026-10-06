const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');

const API_CHANNELS_URL = 'https://reidosembeds.online/api/channels';

async function fetchChannels() {
    try {
        console.log('A efetuar pedido à API:', API_CHANNELS_URL);
        const response = await axios.get(API_CHANNELS_URL, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Referer': 'https://reidosembeds.online/'
            }
        });

        console.log('Resposta da API (Status):', response.status);

        const data = Array.isArray(response.data)
            ? response.data
            : (response.data.channels || response.data.data || response.data.results || []);

        console.log(`Total de canais obtidos: ${data.length}`);
        return data;
    } catch (error) {
        console.error('Erro no fetchChannels:', error.message);
        if (error.response) {
            console.error('Status HTTP do erro:', error.response.status);
        }
        return [];
    }
}

// Extrai o URL caso a API retorne uma tag HTML <iframe> em vez de um link direto
function cleanStreamUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    
    const match = rawUrl.match(/src=["']([^"']+)["']/i);
    if (match && match[1]) {
        return match[1];
    }
    
    return rawUrl.trim();
}

const manifest = {
    id: 'org.reidosembeds.tv',
    version: '1.0.2',
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
        const channels = await fetchChannels();
        
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
        const channels = await fetchChannels();
        const cleanId = id.replace('rde_', '');

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

// 3. Resolução de Stream
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`StreamHandler chamado para ID: ${id}`);
    if (type === 'tv' && id.startsWith('rde_')) {
        const channels = await fetchChannels();
        const cleanId = id.replace('rde_', '');

        const channel = channels.find((c, index) => {
            const cId = String(c.id || c.slug || c.code || index);
            return cId === cleanId;
        });

        if (channel) {
            console.log('Dados do canal localizado:', JSON.stringify(channel));

            const rawUrl = channel.url || channel.stream_url || channel.embed || channel.link || channel.player || channel.iframe || channel.hls || channel.m3u8;
            const finalUrl = cleanStreamUrl(rawUrl);

            if (finalUrl) {
                console.log('URL final do stream:', finalUrl);
                const streams = [];

                if (finalUrl.includes('.m3u8') || finalUrl.includes('.mp4')) {
                    streams.push({
                        title: `Assistir ${channel.name || 'Ao Vivo'} (Direct Stream)`,
                        url: finalUrl
                    });
                }

                streams.push({
                    title: `Abrir Player Externo / Web`,
                    externalUrl: finalUrl
                });

                return { streams };
            } else {
                console.error('Nenhum campo de URL válido foi encontrado no canal.');
            }
        } else {
            console.error(`Canal com ID ${cleanId} não encontrado na resposta.`);
        }
    }
    return { streams: [] };
});

const app = express();
const addonInterface = builder.getInterface();
const sdkRouter = getRouter(addonInterface);

app.use('/', sdkRouter);

module.exports = app;
