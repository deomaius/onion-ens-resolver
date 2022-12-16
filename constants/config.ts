import path from "path"

export default {
  RPC_PROVIDER: "https://api.securerpc.com/v1",
  IFPS_NODE_ENDPOINT: "http://127.0.0.1:5001",
  TOR_PATH: "/usr/local/bin/tor'",
  TOR_BRIDGES: [
    "173.75.1.76:9001 A122240F80A5D3A78082FB75896D57DBAA0EE27F",
    "141.95.17.236:9333 6E896C8EEDD2E163A540179CF9F242F5DBE11FE4",
    "109.228.46.145:6670 245991211BF364DDA6912A15DEF435C722ED5B91",
    "128.199.56.35:4971 D8E724F287A8A12A6516EDBE46E833095979FF9E",
    "78.47.52.169:443 1AD94A236BD087BB69884AC2365D1B3F6D7EBED1",
    "136.24.188.25:9001 3B337FE8FA2FF7772FA796595D2EBF94E535EB37",
    "185.61.119.8:444 2CC11A8D53BF4326B10F0FC895895DA271BDA347",
    "74.105.14.122:9001 C26661629B7B8E05CB11D109360D02447EB9B5B5"
  ],
  SERVER_PORT: 443,
  ONION_PORT: 3000,
  PATH_SSL_KEY: "",
  PATH_SSL_CERT: "",
  GLOCK_CONFIG : {
    packageRoot: `${path.resolve()}/`,
    packageAgent: "onion-ens-resolver@0.1",
    maintainerEmail: "hello@tornado.cash",
    confiDir: "/greenlock.d/",
    staging: true
  },
  GLOCK_MODULES: {
    severname: "3th.ws",
    subscriberEmail: "hello@tornadocash",
    agreeToTerms: true,
    store: {
      module: "greenlock-store-fs",
      basePath: "~/.config/greenlock"
    },
    challenges: {
      "http-01": {
        module: "acme-http-01-webroot"
      },
      "dns-01": {
        module: "acme-dns-01-test"
      }
    }
  }
}
