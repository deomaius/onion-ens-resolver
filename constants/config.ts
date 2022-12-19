
import path from "path"
// import acme_dns from "acme-dns-01-namecheap"
// import http_standalone from "acme-http-01-standalone"

// const httpChallenger = http_standalone.create({})
const dnsChallengeParams = {
    apiUser: 'samueljjgosling',
    apiKey: '87bdd308279c4ee1befa3356b73a13b5',
    clientIp: '80.78.24.190',
    username: 'samueljjgosling',
    baseUrl: 'https://api.namecheap.com/xml.response' 
}

export default {
  DNS_CHALLENGE_PARAMS: dnsChallengeParams,
  RPC_PROVIDER: "https://api.securerpc.com/v1",
  IFPS_NODE_ENDPOINT: "http://127.0.0.1:5001",
  TOR_PATH: "/usr/local/bin/tor",
  SERVER_PORT: 443,
  ONION_PORT: 3000,
  PATH_SSL_CERT: "/etc/letsencrypt/live/3th.ws/fullchain.pem",
  PATH_SSL_KEY: "/etc/letsencrypt/live/3th.ws/privkey.pem",
  TOR_BRIDGES: [
    "173.75.1.76:9001 A122240F80A5D3A78082FB75896D57DBAA0EE27F",
    "141.95.17.236:9333 6E896C8EEDD2E163A540179CF9F242F5DBE11FE4",
    "109.228.46.145:6670 245991211BF364DDA6912A15DEF435C722ED5B91",
    "128.199.56.35:4971 D8E724F287A8A12A6516EDBE46E833095979FF9E",
    "78.47.52.169:443 1AD94A236BD087BB69884AC2365D1B3F6D7EBED1",
    "136.24.188.25:9001 3B337FE8FA2FF7772FA796595D2EBF94E535EB37",
    "185.61.119.8:444 2CC11A8D53BF4326B10F0FC895895DA271BDA347",
    "74.105.14.122:9001 C26661629B7B8E05CB11D109360D02447EB9B5B5",
    "80.247.238.246:444 946744B6BFAA83940CEABC4A7A15DA3D8A405EB4",
    "85.221.227.155:9001 86B3ADB558F4E651B944D9036B350AB80B6D4C3E",
    "131.213.95.17:53823 0B724E15C1D90A281AE38FF50956C2B123C289DE",
    "185.194.93.135:9001 F8C2F613EC974A042603490EE7F64DD8D1663377",
    "205.134.198.6:13696 B8F962E8D56696B1A044A92A07398A86B88C8749",
    "89.147.111.124:9001 B650C9F8D995E2E49F744A53A3260A243127307B"
  ],
  GLOCK_CONFIG : {
    packageRoot: ".",
    packageAgent: "onion-ens-resolver@0.1",
    maintainerEmail: "navalonion@torproject.org",
    configDir: "./greenlock.d/",
    staging: true,
    notify: (e: string, d: any) => { 
      if(e == 'error') {
	console.log(d) 
      }
    } 
  },
  GLOCK_DEFAULTS: {
    subscriberEmail: "navalonion@torproject.org",
    agreeToTerms: true,
    store: {
      module: "greenlock-store-fs",
      basePath: "./.config/greenlock"
    },
    challenges: {
     "http-01": {
       module: "acme-http-01-webroot",
       webroot: "/var/www/.well-known/acme-challenge"
     },
     // "dns-01": {
     //  module: "acme-dns-01-namecheap",
     //  propogationDelay: 200000,
     //  ...dnsChallengeParams
     // }
    }
  }
}
