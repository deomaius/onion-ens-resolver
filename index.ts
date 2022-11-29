import express from "express"
import dotenv from "dotenv"
import cors from "cors"
import fs from "fs"
import path from "path"
import ths from "ths"
import web3 from "web3"
import contentHash from "@ensdomains/content-hash"
import * as tarfs from "tar-fs"

import * as ipfs from "ipfs-http-client"
import * as ft from 'file-type'

import { CID } from 'multiformats/cid'
import { Blob } from 'node:buffer'
import { Readable } from 'node:stream'

import config from './constants/config.js'
import { 
  CIDContentHash, 
  Response, 
  Request 
} from './constants/types.js'

const NA_IPFS_CONTENT = ''
const NODE_ENDPOINT = new URL('http://127.0.0.1:5001')

const IPFS_NODE = ipfs.create({ url: NODE_ENDPOINT })
const TOR_NODE = new ths()
const SERVER = express()
const PORT = 1337

function startResolver() {
  if (!fs.existsSync('./cache')){
    fs.mkdirSync('./cache')
  } 
}

async function getContentHash(label: string): Promise<CIDContentHash> { 
  const provider = new web3(config.rpcProvider)
  const ensContentHash = await provider.eth.ens.getContenthash(label)
  const ipfsContentHash = contentHashToCID(ensContentHash.decoded)

  return ipfsContentHash
}

function contentHashToCID(hash: string): CIDContentHash {
  const { cidV0ToV1Base32 } = contentHash.helpers
  const ipfsCIDv1 = cidV0ToV1Base32(hash)

  return CID.parse(ipfsCIDv1)
}

function uncompressAndCacheContent() { 
}

function getCachedIPFSContent() {}

async function getIPFSContent(contentHash: CIDContentHash): Promise<string> {
  const stream = await IPFS_NODE.get(contentHash.toString())
  const chunks = []

  for await(const e of stream) { chunks.push(e) }

  const cid = contentHash.toString()
  const extBuffer = Buffer.concat(chunks)
  const e = await ft.fileTypeFromBuffer(extBuffer)
  const tarPath = `cache/${cid}.${e?.ext}`
  const extPath = `cache/`

  fs.writeFileSync(tarPath, extBuffer)
  fs.createReadStream(tarPath).pipe(tarfs.extract(extPath))

  return `../${cid}/index.html`
}

async function pinAndCacheIPFSContent(contentHash: CIDContentHash): Promise<boolean> {
  const clientRequest = await IPFS_NODE.pin.add(contentHash.toString())

  return contentHash.cid === clientRequest.cid
}

async function isPinnedContent(contentHash: CIDContentHash): Promise<boolean> {  
  const clientRequest = await IPFS_NODE.pin.ls() 

  let pinnedContent: Array<{ cid: CIDContentHash, type: string }> = []

  for await(const e of clientRequest) {
    pinnedContent = pinnedContent.concat(e)
  }

  const filter = pinnedContent.filter(e => e.cid === contentHash.cid)
  const isPinned = filter.length !== 0

  return isPinned
}

function createHiddenService() {}

function getRegisteredHiddenServices() {}

function loadHiddenService() {}

function getHiddenService() {}

function parseENSDomain(hostname: string): string {
  let ensLabel = hostname.split('.3th.ws')[0]

  if (hostname.includes('onion.')) {
    ensLabel = ensLabel.split('onion.')[1]
  } 

  return ensLabel
}

async function handleWildcardPropogation(
  req: Request,
  res: Response
) {
  let hostName
  // local env, workaround for prototyping
  if (!req.hostname.includes('.3th.ws')) {
    hostName = 'tornadocash.3th.ws'
  } else {
    hostName = req.hostname
  }
  // // // // // // // // // // // // // //
  const serveOnions = hostName.includes('onion.')
  const ensLabel = parseENSDomain(hostName)
  const ensDomain = ensLabel + '.eth'

  try {
    const ipfsContentHash = await getContentHash(ensDomain)
    const ipfsContent = await getIPFSContent(ipfsContentHash)
    const isCached = await isPinnedContent(ipfsContentHash)

    if (ipfsContent === NA_IPFS_CONTENT) {
      res.send("NO IPFS CONTENT AVAILABLE")
    }
    if (!isCached) {
      await pinAndCacheIPFSContent(ipfsContentHash)
    }

    const contentPath = path.join(
      path.resolve(), 'cache', ipfsContentHash.toString()
    ) 
    // if (serveOnions) {
    //  const hiddenService = getsHiddenService(ipfsContentHash)
    // res.redirect(hiddenService.onion)
    // } else { 
    SERVER.use(express.static(contentPath))  
    res.sendFile('index.html', { root: contentPath })
    // }
  } catch (e) {
    res.send(`FAILED TO RESOLVE, ${e}`)
  }
}

SERVER.use(express.urlencoded({ extended: true }))
SERVER.use(express.json())
SERVER.use(express.raw())
SERVER.use(cors())

SERVER.get('/', handleWildcardPropogation)
 
SERVER.listen(PORT, () => {
  try {
    startResolver()
    console.log('// Resolver ::: on //') 
  } catch (e) {
    console.log(`// Failed ::: ${e} //`)
  }
})