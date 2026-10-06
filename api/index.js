const { addonBuilder, getRouter, serveHTTP } = require("stremio-addon-sdk");

// 1. Configuração do Manifesto do Addon
const manifest = {
  id: "org.iracemaflix.external.tv",
  version: "1.2.0",
  name: "IracemaFlix TV",
  description: "Assista aos canais da IracemaFlix abrindo diretamente no navegador externo.",
  resources: ["catalog", "stream"],
  types: ["tv"],
  idPrefixes: ["iracema_"],
  catalogs: [
    {
      type: "tv",
      id: "iracema_catalog",
      name: "IracemaFlix Ao Vivo"
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
  /* Para adicionar mais canais, adicione novos objetos aqui:
  ,{
    id: "iracema_outrocanal",
    name: "Outro Canal",
    poster: "https://link-da-imagem.com/logo.jpg",
    genres: ["Entretenimento"],
    description: "Descrição do canal",
    externalUrl: "https://iracemaflix.eu.cc/tv?id=SEU_ID&type=channel"
  }
  */
];

// 3. Catálogo de Canais no Stremio
builder.defineCatalogHandler(({ type, id }) => {
  if (type === "tv" && id === "iracema_catalog") {
    const metas = CHANNELS.map((channel) => ({
      id: channel.id,
      type: "tv",
      name: channel.name,
      poster: channel.poster,
      genres: channel.genres,
      description: channel.description
    }));

    return Promise.resolve({ metas });
  }

  return Promise.resolve({ metas: [] });
});

// 4. Handler de Stream (Navegador Externo)
builder.defineStreamHandler(({ type, id }) => {
  if (type === "tv") {
    const channel = CHANNELS.find((item) => item.id === id);

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
  }

  return Promise.resolve({ streams: [] });
});

// 5. Exportação compatível com Vercel (Serverless) e Local
const addonInterface = builder.getInterface();

if (process.env.VERCEL || process.env.NODE_ENV === "production") {
  const router = getRouter(addonInterface);

  module.exports = (req, res) => {
    // Cabeçalhos CORS para permitir acesso pelo Stremio Web
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    if (req.method === "OPTIONS") {
      res.statusCode = 200;
      res.end();
      return;
    }

    router(req, res, () => {
      res.statusCode = 404;
      res.end("Not Found");
    });
  };
} else {
  // Teste local via `node api/index.js`
  serveHTTP(addonInterface, { port: 7000 });
  console.log("Addon rodando em http://127.0.0.1:7000/manifest.json");
}
