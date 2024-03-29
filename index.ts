import express from "express"
import cors from "cors"
import fs from "fs"
import path from "path"
import https from "https"
import http from "http"
import tls from "tls" 

import ths from "ths"
import web3 from "web3"
import greenlock from "greenlock"
import enshash from "@ensdomains/content-hash"
import rateLimiter from "express-rate-limit"
import * as ipfs from "ipfs-http-client"
import * as tarfs from "tar-fs"

import { CID } from 'multiformats/cid'
import { Readable } from 'node:stream' 

import config from './constants/config.js'
import message from './constants/msgs.js'
import * as types from './constants/types.js'

const NODE_ENDPOINT = new URL(config.IFPS_NODE_ENDPOINT)
const SSL_REGISTRY = greenlock.create(config.GLOCK_CONFIG)
const IPFS_NODE = ipfs.create({ url: NODE_ENDPOINT })

const ONION_SERVER = express() 
const TOR_NODE = new ths()
const SERVER = express()
const PUBLIC = express()

async function startResolver() {
  const cachePath = path.join(path.resolve(), 'cache')  
  
  if(!fs.existsSync(cachePath)) {
    fs.mkdirSync(cachePath)
  }
 
  await SSL_REGISTRY.manager.defaults(config.GLOCK_DEFAULTS)
  await TOR_NODE.setTorCommand(config.TOR_PATH)
  await TOR_NODE.setBridges(config.TOR_BRIDGES)
  await TOR_NODE.start()
  await TOR_NODE.loadConfig()
}

async function getContentHash(label: string): Promise<types.ContentHash> { 
  const provider = new web3(config.RPC_PROVIDER)
  const ensContentHash = await provider.eth.ens.getContenthash(label)
  const { cidV0ToV1Base32} = enshash.helpers

  const contentHashPath = ensContentHash.decoded

  if(ensContentHash.protocolType) {
    return {
      type: 'ipfs',
      payload: CID.parse(cidV0ToV1Base32(contentHashPath))
    }
  } else {
    const ipnsNameHash = enshash.decode(contentHashPath)
    const ipnsRecord = await IPFS_NODE.name.resolve(ipnsNameHash)

    let ipnsFields: Array<string> = []

    for await(const e of ipnsRecord) {
      ipnsFields = ipnsFields.concat(e)
    }

    const ipnsIpfsv0Hash = ipnsFields[0].split('/ipfs/')[1]

    return {
      payload: CID.parse(cidV0ToV1Base32(ipnsIpfsv0Hash)),
      type: 'ipns'
    }
  }
}

async function createWildcardCertificate(domainPath: string) {
  const wildcardAddress = `*.${domainPath}` 

  await SSL_REGISTRY.add({ subject: wildcardAddress, altnames: [ wildcardAddress ],
     challenges: {
       "dns-01": {
           module: "acme-dns-01-namecheap",
           propogationDelay: 200000,
	   ...config.DNS_CHALLENGE_PARAMS
        }
     }
  }) 
}

async function createCertificate(onionPath: string) {
  await SSL_REGISTRY.add({ subject: onionPath, altnames: [ onionPath ], 
       challenges: {
       "http-01": {
           module: "acme-http-01-webroot",
           webroot: "/var/www/.well-known/acme-challenge"
        }
     } 
  }) 
}

async function getCertificate(domainPath: string): Promise<types.CertKeypair | undefined> {
  try {
    const matchingRequest = await SSL_REGISTRY.get({ servername: domainPath })
  
    if (matchingRequest?.pems) {
     return {
        key: matchingRequest.pems.privkey,
        cert: matchingRequest.pems.cert 
      }
    } 
   } catch (e) {   
      try {
        let wildcardPaths = domainPath.split('.')

        wildcardPaths.shift()

        const wildcardRootPath = wildcardPaths.join('.')
        const wildcardAddress = wildcardRootPath || domainPath
        const secondaryRequest = await SSL_REGISTRY.get({ servername: `*.${wildcardAddress}` })

        if(secondaryRequest?.pems) {
          return {
            key: secondaryRequest.pems.privkey,
            cert: secondaryRequest.pems.cert
          }
        }
     } catch (e) { }
  }   
  return undefined
}

async function pinIPFSContent(contentHash: types.CIDContentHash) {
  await IPFS_NODE.pin.add(contentHash.toString())
}

async function unpinIPFSContent(contentHash: types.CIDContentHash) {
  await IPFS_NODE.pin.rm(contentHash.toString())
}

function contentHashToCID(contentHash: string): types.CIDContentHash {
  const ipfsCIDv1 = enshash.helpers.cidV0ToV1Base32(contentHash)

  return CID.parse(ipfsCIDv1)
}

async function getIPFSContent(contentHash: types.CIDContentHash): Promise<Buffer> {   
  const stream = await IPFS_NODE.get(contentHash.toString())
  const chunks = []

  for await(const x of stream) { chunks.push(x) }

  return Buffer.concat(chunks)
}

async function cacheIPFSContent(
  contentPath: string,
  contentBuffer: Buffer
) {  
  const completeCallback = () => {
    const doesExist = fs.existsSync(contentPath)

    if (doesExist) {
      const isDir = fs.lstatSync(contentPath).isDirectory()
      
      if (!isDir) {
        fs.renameSync(contentPath, contentPath + '.html')
      }
    }
  }
  const bufferStream = Readable.from(contentBuffer)

  bufferStream.pipe(tarfs.extract('./cache/', { 
     finalize: true, finish: completeCallback 
   }, 
    completeCallback
  ))
}

async function deleteCacheContent(contentPath: string) { 
    try {
     await fs.rmSync(contentPath, { recursive: true, force: true })
    } catch (e) {} 
    try {
     await fs.rmSync(contentPath + '.html')
    } catch (e) {}
}

async function isPinnedContent(contentHash: types.CIDContentHash): Promise<boolean> {  
  const clientRequest = await IPFS_NODE.pin.ls() 

  let pinnedContent: Array<{ cid: types.CIDContentHash, type: string }> = []

  for await(const e of clientRequest) { pinnedContent = pinnedContent.concat(e) }

  const isPinned = pinnedContent.find((e) => e.cid.toString() === contentHash.toString())

  return isPinned !== undefined
}

async function createHiddenService(contentHash: types.CIDContentHash) {
    await TOR_NODE.createHiddenService(contentHash.toString(), [ config.ONION_PORT ], true)
    await TOR_NODE.saveConfig()
}

async function getHiddenService(contentHash: types.CIDContentHash): Promise<string> {
  const targetContentHash = contentHash.toString().toLowerCase()

  let onionAddress
 
  try {
    await TOR_NODE.loadConfig()

    let activeServices = await TOR_NODE.getServices()   
    let matchingService = activeServices.find((e:any) => e.name == targetContentHash) 

    if(!matchingService) {
      await createHiddenService(targetContentHash)
      await TOR_NODE.loadConfig()

      activeServices = await TOR_NODE.getServices()
      matchingService = activeServices.find((e:any) => e.name == targetContentHash)
     }

    onionAddress = matchingService.hostname
  } catch (e) { } 
  
  return onionAddress
}

function parseENSDomain(hostname: string): string {
  let ensLabel = hostname.split('.3th.ws')[0]

  if (hostname.includes('onion.')) {
    ensLabel = ensLabel.split('onion.')[1]
  } 

  return ensLabel
}

async function getContentHashFromOnionAddress(onionAddress: string): Promise<string | undefined> {
  try {
    await TOR_NODE.loadConfig()

    const activeServices = await TOR_NODE.getServices()
    const matchingService = activeServices.find((e:any) => e.hostname == onionAddress.toLowerCase())

    return matchingService.name
  } catch (e) { 
    return undefined
  }
}

async function reverseOnionPropogation(
  req: types.Request,
  res: types.Response
) {
  const ipfsHash = await getContentHashFromOnionAddress(req.hostname)
  
  if(ipfsHash) {
    const onionPath = path.join(path.resolve(), 'cache', ipfsHash)  
    const isStaticDir = fs.existsSync(onionPath + '/index.html')
    const isStatic = fs.existsSync(onionPath + '.html')
    const hasStaticContent = isStaticDir || isStatic

    const servePath = isStaticDir ? onionPath : `${path.resolve()}/cache/`
    const fileName = isStaticDir ? 'index' : ipfsHash

    ONION_SERVER.use(express.static(servePath))
    res.sendFile(`${fileName}.html`, { root: servePath })
   } else {
    res.send(message.ERR_REVERSE_ONION) 
  }
  return 
}

async function wildcardPropogation(
  req: types.Request,
  res: types.Response
) {
  const hostName = req.hostname
  const serveOnions = hostName?.includes('onion.')
  
  try {
    const ensLabel = parseENSDomain(hostName)
    const ensDomain = ensLabel + '.eth'

    const { type, payload } = await getContentHash(ensDomain)
    const ipfsContentHash = payload

    if (!(type === 'ipfs' || type === 'ipns')) {
      res.send(message.ERR_UNSUPPORTED_TYPE) 
      return 
    }
    const isCached = await isPinnedContent(ipfsContentHash)
    const contentPath = path.join(
      path.resolve(), 'cache', ipfsContentHash.toString()
    )
    let isStaticDir = fs.existsSync(contentPath + '/index.html')
    let isStatic = fs.existsSync(contentPath + '.html')
    let hasStaticContent = isStaticDir || isStatic

    if (!isCached && !hasStaticContent) {
      const ipfsContent = await getIPFSContent(ipfsContentHash)
    
      if (ipfsContent.length === 0) {
        res.send(message.ERR_FAILED_FETCH)
        return
      } else {
        await cacheIPFSContent(contentPath, ipfsContent)

        isStaticDir = fs.existsSync(contentPath + '/index.html')
        isStatic = fs.existsSync(contentPath + '.html')
        hasStaticContent = isStaticDir || isStatic
      } 
    }
   
    if (!hasStaticContent) {     
      await deleteCacheContent(contentPath)

      res.send(message.ERR_NO_STATIC_CONTENT)
      return
    } else if (!isCached) {
      await pinIPFSContent(ipfsContentHash)
    }

    if (serveOnions) {
      const onionAddress = await getHiddenService(ipfsContentHash)

      if(onionAddress) { 
         res.redirect(301, `https://${onionAddress}`)
      } else {
         res.send(message.ERR_NO_ONION_SERVICE)
      }
      return
    } else {  
      const cachePath = path.resolve() + '/cache/'
      const servePath = isStaticDir ? contentPath : cachePath
      const fileName = isStaticDir ? 'index' : ipfsContentHash.toString()

      SERVER.use(express.static(servePath))
      res.sendFile(`${fileName}.html`, { root: servePath })  
      return
    }
  } catch (e) {
    res.send(message.ERR_RESOLVE_CONFLICT)
    console.log(e)
    return
  }
}

async function handleCertificate(hostName: string, ctx: Function) {
  const hostPaths = hostName.split('.')
  const isFirstLevelDomain = hostPaths[2] == "ws" || hostName[1] == "ws"
  const isRootDomain = hostPaths[1] == "ws" || isFirstLevelDomain
  const isOnionAddress = hostPaths[hostPaths.length - 1] == 'onion'
  const isDomain = hostName.includes('3th.ws')
  
  const defaultKeypair = {
    cert: fs.readFileSync(config.PATH_SSL_CERT),
    key: fs.readFileSync(config.PATH_SSL_KEY) 
  } 

  let sslKeypair = defaultKeypair

  if (!isRootDomain && isDomain) {
    let cachedCertificate = await getCertificate(hostName)    
 
     if (!cachedCertificate) {
      await createCertificate(hostName)

      cachedCertificate = await getCertificate(hostName)
     }

     if (cachedCertificate) {
       sslKeypair = cachedCertificate
     } 
  }
  
  const selectedContext = tls.createSecureContext({ ...sslKeypair })
  
  ctx(null, selectedContext)
}

const RATE_LIMITER = rateLimiter({  
    windowMs: 10 * 60 * 1000,
    max: 50,
    message: "TOO MANY REQUESTS",
    standardHeaders: true,
    legacyHeaders: false
})

ONION_SERVER.use(RATE_LIMITER)
SERVER.use(RATE_LIMITER)

SERVER.use(express.urlencoded({ extended: true }))
SERVER.use(express.json())
SERVER.use(express.raw())
SERVER.use(cors())

ONION_SERVER.get('/', reverseOnionPropogation)
SERVER.get('/', wildcardPropogation)

const RESOLVER_CONFIG = { SNICallback: handleCertificate } 
const HTTPS_CONFIG = {
  key: fs.readFileSync(config.PATH_SSL_KEY),
  cert: fs.readFileSync(config.PATH_SSL_CERT) 
}
const HIDDEN_SERVICE = https.createServer(HTTPS_CONFIG, ONION_SERVER)
const RESOLVER = https.createServer(RESOLVER_CONFIG, SERVER)

RESOLVER.listen(443, async() => {
  try {
    await HIDDEN_SERVICE.listen(config.ONION_PORT)
    await startResolver()
    console.log(message.SERVER_INIT) 
  } catch (e) {
    console.log(message.SERVER_FAIL)
    console.log(e)
  }
})
