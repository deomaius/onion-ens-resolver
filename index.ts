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
const TOR_NODE = new ths(path.join(path.resolve(), 'cache'))
const SERVER = express()
const RSERVER = express()
const PORT = 1337
const RPORT = 3000

async function startResolver() {
  await TOR_NODE.setTorCommand('/usr/local/bin/tor')
  await TOR_NODE.loadConfig()
  await TOR_NODE.start(true)
  await RSERVER.listen(RPORT)
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

  let pinnedContent: Array<{ cid: CIDContentHash, type: string }> = []

  for await(const e of clientRequest) { pinnedContent = pinnedContent.concat(e) }

  const filter = pinnedContent.filter((e) => e.cid.toString() === contentHash.toString())
  const isPinned = filter.length !== 0

  return isPinned
}

async function createHiddenService(contentHash: CIDContentHash | string) {
    await TOR_NODE.createHiddenService(contentHash.toString(), [ 3000 ],  true)
}

async function getHiddenService(
  contentHash: CIDContentHash | string,
  isCached: boolean
) {
  let onionAddress
 
  try {
    let activeServices = await TOR_NODE.getServices()   
    let cachedServices = activeServices.filter((e: any) => e.name == contentHash.toString())
 
    if(cachedServices.length == 0) {
      await createHiddenService(contentHash)
       
      activeServices = await TOR_NODE.getServices()
      cachedServices = activeServices.filter((e: any) => e.name == contentHash.toString())
    }
    
    onionAddress = cachedServices[0]?.hostname
  } catch (e) {  } 
  
  return onionAddress
}

function parseENSDomain(hostname: string): string {
  let ensLabel = hostname.split('.3th.ws')[0]

  if (hostname.includes('onion.')) {
    ensLabel = ensLabel.split('onion.')[1]
  } 

  return ensLabel
}

async function getContentHashFromOnionAddress(onionAddress: string): Promise<string> {
  const activeServices = await TOR_NODE.getServices()
  const matchingServices = activeServices.filter((e:any) => e.hostname == onionAddress)

  return matchingServices[0]?.name
}

async function handleWildcardOnions(
  req: Request,
  res: Response
) {
  const ipfsHash = await getContentHashFromOnionAddress(req.hostname)
  
  if(ipfsHash) {
    const dynamicOnionPath = path.join(
      path.resolve(), 'cache', ipfsHash
    )  

    RSERVER.use(express.static(dynamicOnionPath))
    res.sendFile('index.html', { root: dynamicOnionPath })
  
    return
  } else {
    res.send('NO IPFS STORE')
  }
}

async function handleWildcardPropogation(
  req: Request,
  res: Response
) {
  let hostName
  // local env, workaround for prototyping
  if (!req.hostname.includes('.3th.ws')) {
    hostName = 'onion.tornadocashcommunity.3th.ws'
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
      return
    }

    const isCached = await isPinnedContent(ipfsContentHash)

    if(!isCached) {
      const ipfsContent = await getIPFSContent(ipfsContentHash)

      await cacheIPFSContent(ipfsContentHash, ipfsContent)
      await pinIPFSContent(ipfsContentHash)
    }

    const contentPath = path.join(
      path.resolve(), 'cache', ipfsContentHash.toString()
    ) 

    if (!fs.existsSync(path.join(contentPath, 'index.html'))) {
      res.send("NO STATIC CONTENT AVAILABLE")
      return
    }

    if (serveOnions) {
      const hiddenService = await getHiddenService(
        ipfsContentHash, 
        isCached
      )

      if(hiddenService) { 
	     res.send(hiddenService)
      } else {
	     res.send('NO ONIONS')
      }
      return
    } else { 
      SERVER.use(express.static(contentPath))  
      
      res.sendFile('index.html', { root: contentPath })
      
      return
    }
  } catch (e) {
    console.log('ERROR', e)
    res.send('FAILED TO RESOLVE')
    return
  }
}

SERVER.use(express.urlencoded({ extended: true }))
SERVER.use(express.json())
SERVER.use(express.raw())
SERVER.use(cors())

SERVER.get('/', handleWildcardPropogation)
RSERVER.get('/', handleWildcardOnions)
 
SERVER.listen(PORT, async() => {
  try {
    await startResolver()
    console.log('// Resolver ::: on //') 
  } catch (e) {
    console.log(`// Failed ::: ${e} //`)
  }
})
