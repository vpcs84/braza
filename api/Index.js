const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");

const app = express();

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
    description: "Addon de TV ao vivo com raspagem direta dos canais do IracemaFlix.",
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

        // 1. Resposta em formato JSON/API
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

        // 2. Scraping via Expressões Regulares no HTML
        const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        let channelCount = 0;

        while ((match = linkRegex.exec(html)) !== null) {
            const href = match[1];
            const rawContent = match[2];

            if (href.includes("/canal") || href.includes("/play") || href.includes("/watch") || href.includes(".m3u8") || href.includes("id=")) {
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

        // 3. Fallback: Busca por links HLS (.m3u8) diretos
        if (channels.length === 0) {
            const m3u8Regex = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi;
            let m3u8Match;
            let idx = 1;
            while ((m3u8Match = m3u8Regex.exec(html)) !== null) {
                channels.push({
                    id: `iracema:${encodeURIComponent(m3u8Match[1])}`,
                    name: `Canal HLS ${idx++}`,
                    type: "tv",
                    poster: "https://via.placeholder.com/300x450?text=IracemaFlix+TV",
                    description: "Sinal direto HLS."
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

        if (rawTarget.endsWith(".m3u8") || rawTarget.includes(".m3u8") || rawTarget.endsWith(".mp4")) {
            return {
                streams: [{
                    url: rawTarget,
                    title: "Sinal Direto (HLS)",
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
            const response = await axios.get(rawTarget, {
                headers: DEFAULT_HEADERS,
                timeout: 8000
            });

            const pageHtml = response.data;
            let streamUrl = null;

            const m3u8Match = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i.exec(pageHtml);
            if (m3u8Match) {
                streamUrl = m3u8Match[1];
            } else {
                const iframeMatch = /<iframe\s+[^>]*src=["']([^"']+)["']/i.exec(pageHtml);
                if (iframeMatch) {
                    let iframeUrl = iframeMatch[1];
                    if (!iframeUrl.startsWith("http")) {
                        iframeUrl = new URL(iframeUrl, BASE_URL).href;
                    }
                    
                    const iframeRes = await axios.get(iframeUrl, {
                        headers: { ...DEFAULT_HEADERS, Referer: rawTarget },
                        timeout: 8000
                    });
                    const iframeHtml = iframeRes.data;
                    const subM3u8 = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i.exec(iframeHtml);
                    if (subM3u8) {
                        streamUrl = subM3u8[1];
                    }
                }
            }

            if (streamUrl) {
                return {
                    streams: [{
                        url: streamUrl,
                        title: "IracemaFlix - Stream Ao Vivo",
                        behaviorHints: {
                            requestHeaders: {
                                "User-Agent": DEFAULT_HEADERS["User-Agent"],
                                "Referer": rawTarget
                            }
                        }
                    }]
                };
            }
        } catch (err) {
            console.error(`Erro no stream: ${err.message}`);
        }
    }

    return { streams: [] };
});

const addonInterface = builder.getInterface();
const addonRouter = getRouter(addonInterface);

app.use("/", addonRouter);

module.exports = app;
