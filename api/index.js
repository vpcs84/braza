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

// Normaliza a URL tratando prefixos do Vercel
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
    description: "Addon de TV ao vivo com suporte a canais e streams HTTP.",
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

        if (typeof html === "object") {
            const list = Array.isArray(html) ? html : (html.channels || html.canais || html.items || []);
            list.forEach((item, index) => {
                const title = item.name || item.title || item.nome || `Canal ${index + 1}`;
                const streamUrl = item.url || item.stream || item.link;
                const logo = item.logo || item.icon || item.poster || "https://via.placeholder.com/300x450?text=IracemaFlix+TV";
                
                if (streamUrl || item.id) {
                    channels.push({
                        id: `iracema:${encodeURIComponent(streamUrl || item.id)}`,
                        name: title,
                        type: "tv",
                        poster: logo,
                        description: `Assista ${title} ao vivo via IracemaFlix.`
                    });
                }
            });
            return channels;
        }

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
                    description: `Transmissão ao vivo do canal ${title}`
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

        // 1. Se o destino já for um arquivo/stream direto em HTTP (.ts, .m3u8, .mp4 ou porta/live)
        if (/\.(m3u8|ts|mp4|mkv)(\?.*)?$/i.test(rawTarget)) {
            return {
                streams: [{
                    url: rawTarget,
                    title: "Sinal HTTP Direto",
                    behaviorHints: {
                        requestHeaders: {
                            "User-Agent": DEFAULT_HEADERS["User-Agent"],
                            "Referer": BASE_URL
                        }
                    }
                }]
            };
        }

        try {
            // 2. Tenta raspar o player da página para capturar links de stream HTTP
            const response = await axios.get(rawTarget, {
                headers: DEFAULT_HEADERS,
                timeout: 8000,
                maxRedirects: 5
            });

            const pageHtml = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
            let streamUrl = null;

            // Busca arquivos de mídia no HTML
            const mediaRegex = /(https?:\/\/[^\s"'<>]+\.(?:m3u8|ts|mp4|mkv)[^\s"'<>]*)/i;
            // Busca variáveis em scripts de players (file: "http...", source: "http...", src: "http...")
            const playerJsRegex = /(?:file|source|src|stream|link)\s*[:=]\s*["'](https?:\/\/[^"']+)["']/i;
            // Busca tags <video> ou <source>
            const videoTagRegex = /<(?:source|video)[^>]*src=["']([^"']+)["']/i;
            // Busca iframes de players externos
            const iframeRegex = /<iframe\s+[^>]*src=["']([^"']+)["']/i;

            let match = mediaRegex.exec(pageHtml) || playerJsRegex.exec(pageHtml) || videoTagRegex.exec(pageHtml);

            if (match) {
                streamUrl = match[1];
            } else {
                const iframeMatch = iframeRegex.exec(pageHtml);
                if (iframeMatch) {
                    let iframeUrl = iframeMatch[1];
                    if (!iframeUrl.startsWith("http")) {
                        iframeUrl = new URL(iframeUrl, BASE_URL).href;
                    }

                    const iframeRes = await axios.get(iframeUrl, {
                        headers: { ...DEFAULT_HEADERS, Referer: rawTarget },
                        timeout: 8000
                    });
                    const iframeHtml = typeof iframeRes.data === "string" ? iframeRes.data : JSON.stringify(iframeRes.data);
                    
                    const subMatch = mediaRegex.exec(iframeHtml) || playerJsRegex.exec(iframeHtml) || videoTagRegex.exec(iframeHtml);
                    if (subMatch) {
                        streamUrl = subMatch[1];
                    }
                }
            }

            if (streamUrl) {
                return {
                    streams: [{
                        url: streamUrl,
                        title: "IracemaFlix - Stream HTTP",
                        behaviorHints: {
                            requestHeaders: {
                                "User-Agent": DEFAULT_HEADERS["User-Agent"],
                                "Referer": rawTarget
                            }
                        }
                    }]
                };
            }

            // 3. Fallback: Se não achou arquivo de mídia no HTML, envia a própria URL HTTP
            return {
                streams: [{
                    url: rawTarget,
                    title: "IracemaFlix - Canal HTTP",
                    behaviorHints: {
                        requestHeaders: {
                            "User-Agent": DEFAULT_HEADERS["User-Agent"],
                            "Referer": BASE_URL
                        }
                    }
                }]
            };

        } catch (err) {
            console.error(`Erro no stream HTTP: ${err.message}`);
            // Retorna o link original em caso de falha de parsing
            return {
                streams: [{
                    url: rawTarget,
                    title: "IracemaFlix - Link Direto",
                    behaviorHints: {
                        requestHeaders: {
                            "User-Agent": DEFAULT_HEADERS["User-Agent"],
                            "Referer": BASE_URL
                        }
                    }
                }]
            };
        }
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
