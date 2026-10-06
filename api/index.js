const { addonBuilder, getRouter } = require("stremio-addon-sdk");

// 1. Configuração do Manifesto do Addon
const manifest = {
  id: "org.iracemaflix.tv",
  version: "1.0.0",
  name: "IracemaFlix TV",
  description: "Canais ao vivo via IracemaFlix",
  resources: ["catalog", "stream"],
  types: ["tv"],
  idPrefixes: ["iracema_"],
  catalogs: [
    {
      type: "tv",
      id: "iracema_catalog",
      name: "IracemaFlix Ao Vivo"
    }
  ]
};

const builder = new addonBuilder(manifest);

// 2. Lista de Canais (Expansível para novos canais)
const CHANNELS = [
  {
    id: "iracema_globonews",
    name: "GloboNews",
    poster: "https://s2.glbimg.com/O4Q8iJ2R-8q9K9V0/globonews.jpg",
    description: "GloboNews ao vivo via IracemaFlix",
    externalUrl: "https://iracemaflix.eu.cc/tv?id=globonews&type=channel"
  }
];

// 3. Catálogo exibido no Stremio
builder.defineCatalogHandler(({ type, id }) => {
  if (type === "tv" && id === "iracema_catalog") {
    const metas = CHANNELS.map((channel) => ({
      id: channel.id,
      type: "tv",
      name: channel.name,
      poster: channel.poster,
      description: channel.description
    }));

    return Promise.resolve({ metas });
  }

  return Promise.resolve({ metas: [] });
});

// 4. Fluxo de reprodução do canal selecionado
builder.defineStreamHandler(({ type, id }) => {
  if (type === "tv") {
    const channel = CHANNELS.find((item) => item.id === id);

    if (channel) {
      return Promise.resolve({
        streams: [
          {
            title: "Abrir Player Web (IracemaFlix)",
            externalUrl: channel.externalUrl
          }
        ]
      });
    }
  }

  return Promise.resolve({ streams: [] });
});

// 5. Export para compatibilidade com a Vercel
const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

module.exports = (req, res) => {
  router(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
};
