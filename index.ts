import express from "express"
import dotenv from "dotenv"
import cors from "cors"
import fs from "fs"
import path from "path"
import ths from "ths"
import web3 from "web3"
import enshash from "@ensdomains/content-hash"
import * as tarfs from "tar-fs"

import * as ipfs from "ipfs-http-client"
import * as ft from 'file-type'

import { CID } from 'multiformats/cid'
import { base64 } from 'multiformats/bases/base64'
import { Blob } from 'node:buffer'
import { Readable } from 'node:stream'

import config from './constants/config.js'
import { 
  CIDContentHash,
  ContentHash, 
  Response, 
  Request 
} from './constants/types.js'

const NA_IPFS_CONTENT = new Buffer([])
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

async function getContentHash(label: string): Promise<ContentHash> { 
  const provider = new web3(config.rpcProvider)
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

function contentHashToCID(contentHash: string): CIDContentHash {
  const ipfsCIDv1 = enshash.helpers.cidV0ToV1Base32(contentHash)

  return CID.parse(ipfsCIDv1)
}

async function getIPFSContent(contentHash: CIDContentHash | string): Promise<Buffer> {
  const stream = await IPFS_NODE.get(contentHash.toString())
  const chunks = []

  for await(const e of stream) { chunks.push(e) }

  return Buffer.concat(chunks)
}

async function cacheIPFSContent(
  contentHash: CIDContentHash | string, 
  contentBuffer: Buffer
) {
  const tarPath = `cache/${contentHash.toString()}.tar`
  const extPath = `cache/`

  if (!fs.existsSync(tarPath)) {
    const cid = contentHash.toString()

    await fs.writeFileSync(tarPath, contentBuffer)
    await fs.createReadStream(tarPath).pipe(tarfs.extract(extPath))
  }
}

async function pinIPFSContent(contentHash: CIDContentHash | string): Promise<boolean> {
  const clientRequest = await IPFS_NODE.pin.add(contentHash.toString())

  return contentHash.cid === clientRequest.cid
}

async function isPinnedContent(contentHash: CIDContentHash | string): Promise<boolean> {  
  const clientRequest = await IPFS_NODE.pin.ls() 

  let pinnedContent: Array<{ cid: CIDContentHash | string, type: string }> = []

  for await(const e of clientRequest) {
    pinnedContent = pinnedContent.concat(e)
  }

  const filter = pinnedContent.filter(e => e.cid === contentHash.cid)
  const isPinned = filter.length !== 0

  return isPinned
}

function createHiddenService() {}

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
    hostName = 'firn.3th.ws'
  } else {
    hostName = req.hostname
  }
  // // // // // // // // // // // // // //
  const serveOnions = hostName.includes('onion.')
  const ensLabel = parseENSDomain(hostName)
  const ensDomain = ensLabel + '.eth'

  try {
    const { type, payload } = await getContentHash(ensDomain)
    const ipfsContentHash = payload

    if (!(type === 'ipfs' || type === 'ipns')) {
      res.send("CONTENT NOT SUPPORTED") 
    }

    const isCached = await isPinnedContent(ipfsContentHash)

    if(!isCached) {
      const ipfsContent = await getIPFSContent(ipfsContentHash)

      await cacheIPFSContent(ipfsContentHash, ipfsContent)
      await pinIPFSContent(ipfsContentHash)
    }

    const contentPath = path.join(
      path.resolve(), 'cache', ipfsContentHash.toString(), 
    ) 

    // if (!fs.existsSync(contentPath + 'index.html')) {
    //  res.send("NO STATIC CONTENT AVAILABLE")
    // }

    if (serveOnions) {
      const hiddenService = getHiddenService()
      
      res.send('NO ONIONS')
    } else { 
      SERVER.use(express.static(contentPath))  
      res.sendFile('index.html', { root: contentPath })
    }
  } catch (e) {
    console.log('ERROR', e)
    res.send('FAILED TO RESOLVE')
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