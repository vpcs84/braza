const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");

const app = express();

// Configuração de CORS
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    next();
});

// Normaliza URLs vindas do Vercel
app.use((req, res, next) => {
    req.url = req.url.replace(/^\/api(\/index(\.js)?)?/i, "");
    if (!req.url || req.url === "" || req.url.toLowerCase() === "/index") {
        req.url = "/";
    }
    next();
});

const DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webkit,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://iracemaflix.eu.cc/"
};

const BASE_URL = "https://iracemaflix.eu.cc";
const CANAIS_URL = `${BASE_URL}/canais`;

const manifest = {
    id: "org.iracemaflix.scraper.addon",
    version: "1.0.0",
    name: "IracemaFlix Canais",
    description: "Addon de TV ao vivo com links para abertura no navegador.",
    resources: ["catalog", "stream"],
    types: ["tv"],
    catalogs: [
        {
            type: "tv",
            id: "iracemaflix_tv",
            name: "IracemaFlix TV",
            extra: [{ name: "search", isRequired: false }]
        }
    ],
    idPrefixes: ["iracema:"]
};

const builder = new addonBuilder(manifest);

async function fetchChannels() {
    try {
        const response = await axios.get(CANAIS_URL, {
            headers: DEFAULT_HEADERS,
            timeout: 8000
        });

        const html = response.data;
        const channels = [];

        // 1. Resposta JSON
        if (typeof html === "object") {
            const list = Array.isArray(html) ? html : (html.channels || html.canais || html.items || []);
            list.forEach((item, index) => {
                const title = item.name || item.title || item.nome || `Canal ${index + 1}`;
                const targetUrl = item.url || item.link || item.stream;
                const logo = item.logo || item.icon || item.poster || "https://via.placeholder.com/300x450?text=IracemaFlix+TV";
                
                if (targetUrl) {
                    channels.push({
                        id: `iracema:${encodeURIComponent(targetUrl)}`,
                        name: title,
                        type: "tv",
                        poster: logo,
                        description: `Abrir ${title} no navegador.`
                    });
                }
            });
            return channels;
        }

        // 2. Scraping HTML
        const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        let channelCount = 0;

        while ((match = linkRegex.exec(html)) !== null) {
            const href = match[1];
            const rawContent = match[2];

            if (href.includes("/canal") || href.includes("/play") || href.includes("/watch") || href.includes("id=") || href.startsWith("http")) {
                let title = rawContent.replace(/<[^>]+>/g, "").trim();
                const imgMatch = /src=["']([^"']+)["']/i.exec(rawContent);
                let logo = imgMatch ? imgMatch[1] : null;

                if (logo && !logo.startsWith("http")) {
                    logo = new URL(logo, BASE_URL).href;
                }

                if (!title) {
                    title = `Canal ${++channelCount}`;
                }

                let fullTarget = href.startsWith("http") ? href : new URL(href, BASE_URL).href;

                channels.push({
                    id: `iracema:${encodeURIComponent(fullTarget)}`,
                    name: title,
                    type: "tv",
                    poster: logo || "https://via.placeholder.com/300x450?text=IracemaFlix+TV",
                    description: `Link para abrir no navegador: ${title}`
                });
            }
        }

        return channels;
    } catch (err) {
        console.error("Erro no catálogo:", err.message);
        return [];
    }
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type === "tv" && id === "iracemaflix_tv") {
        let channels = await fetchChannels();

        if (extra && extra.search) {
            const query = extra.search.toLowerCase();
            channels = channels.filter(c => c.name.toLowerCase().includes(query));
        }

        return { metas: channels };
    }
    return { metas: [] };
});

builder.defineStreamHandler(async ({ type, id }) => {
    if (type === "tv" && id.startsWith("iracema:")) {
        const rawTarget = decodeURIComponent(id.replace("iracema:", ""));

        // Retorna externalUrl para acionar a abertura no navegador padrão do dispositivo
        return {
            streams: [
                {
                    externalUrl: rawTarget,
                    title: "🌐 Abrir no Navegador"
                }
            ]
        };
    }

    return { streams: [] };
});

const addonInterface = builder.getInterface();
const addonRouter = getRouter(addonInterface);

// Redireciona a raiz para o manifesto
app.get("/", (req, res) => {
    res.redirect("/manifest.json");
});

app.use("/", addonRouter);

module.exports = app;
