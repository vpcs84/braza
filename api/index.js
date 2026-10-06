const express = require("express");
const { addonBuilder, getRouter, serveHTTP } = require("stremio-addon-sdk");

// 1. Configuração do Manifesto do Addon
const manifest = {
  id: "org.iracemaflix.external.tv",
  version: "1.3.0",
  name: "IracemaFlix TV",
  description: "Canais da IracemaFlix com reprodução em navegador externo.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "tv"],
  idPrefixes: ["iracema_"],
  catalogs: [
    {
      type: "movie",
      id: "iracema_catalog_movie",
      name: "IracemaFlix Ao Vivo"
    },
    {
      type: "tv",
      id: "iracema_catalog_tv",
      name: "IracemaFlix (Canais)"
    }
  ],
  logo: "https://s2.glbimg.com/O4Q8iJ2R-8q9K9V0/globonews.jpg"
};

const builder = new addonBuilder(manifest);

// 2. Base de Dados dos Canais
const CHANNELS = [
  {
    id: "iracema_globonews",
    name: "GloboNews",
    poster: "https://s2.glbimg.com/O4Q8iJ2R-8q9K9V0/globonews.jpg",
    genres: ["Notícias", "Ao Vivo"],
    description: "Canal GloboNews ao vivo transmitido via IracemaFlix.",
    externalUrl: "https://iracemaflix.eu.cc/tv?id=globonews&type=channel"
  }
];

// Função auxiliar para gerar metadados válidos
function getMeta(channel, type) {
  const meta = {
    id: channel.id,
    type: type,
    name: channel.name,
    poster: channel.poster,
    genres: channel.genres,
    description: channel.description
  };

  // Se o tipo for 'tv', incluímos um 'episódio' para o Stremio habilitar a busca de streams
  if (type === "tv") {
    meta.videos = [
      {
        id: channel.id,
        title: "Transmissão Ao Vivo",
        released: new Date().toISOString()
      }
    ];
  }

  return meta;
}

// 3. Handler do Catálogo
builder.defineCatalogHandler(({ type, id }) => {
  if (id.startsWith("iracema_catalog")) {
    const metas = CHANNELS.map((channel) => getMeta(channel, type));
    return Promise.resolve({ metas });
  }
  return Promise.resolve({ metas: [] });
});

// 4. Handler de Metadados (Necessário para exibir a tela do canal e botões)
builder.defineMetaHandler(({ type, id }) => {
  const channel = CHANNELS.find((item) => item.id === id || id.startsWith(item.id));
  if (channel) {
    return Promise.resolve({ meta: getMeta(channel, type) });
  }
  return Promise.resolve({ meta: null });
});

// 5. Handler de Stream (Gera o botão do link externo)
builder.defineStreamHandler(({ type, id }) => {
  const channel = CHANNELS.find((item) => item.id === id || id.startsWith(item.id));

  if (channel) {
    return Promise.resolve({
      streams: [
        {
          title: "🌐 Abrir no Navegador (IracemaFlix)",
          externalUrl: channel.externalUrl
        }
      ]
    });
  }

  return Promise.resolve({ streams: [] });
});

// 6. Integração Express + Serverless da Vercel
const addonInterface = builder.getInterface();
const app = express();

// Middlewares para CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

const router = getRouter(addonInterface);
app.use("/", router);

if (process.env.VERCEL || process.env.NODE_ENV === "production") {
  module.exports = app;
} else {
  serveHTTP(addonInterface, { port: 7000 });
  console.log("Addon rodando localmente em http://127.0.0.1:7000/manifest.json");
}
