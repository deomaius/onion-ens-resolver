import express from "express"
import cors from "cors"
import fs from "fs"
import path from "path"

import ths from "ths"
import web3 from "web3"
import enshash from "@ensdomains/content-hash"
import * as ipfs from "ipfs-http-client"
import * as tarfs from "tar-fs"

import { CID } from 'multiformats/cid'
import { base64 } from 'multiformats/bases/base64'
import { Blob } from 'node:buffer'
import { Readable } from 'node:stream'

import config from './constants/config.js'
import message from './constants/msgs.js'
import * as types from './constants/types.js'

const NODE_ENDPOINT = new URL(config.IFPS_NODE_ENDPOINT)
const IPFS_NODE = ipfs.create({ url: NODE_ENDPOINT })
const TOR_NODE = new ths()
const SERVER = express()
const ONION_SERVER = express()

async function startResolver() {
  await TOR_NODE.setTorCommand(config.TOR_PATH)
  await TOR_NODE.loadConfig()
  await TOR_NODE.start(true)
  await ONION_SERVER.listen(config.ONION_PORT)
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

function contentHashToCID(contentHash: string): types.CIDContentHash {
  const ipfsCIDv1 = enshash.helpers.cidV0ToV1Base32(contentHash)

  return CID.parse(ipfsCIDv1)
}

async function getIPFSContent(contentHash: types.CIDContentHash): Promise<Buffer> {
  const stream = await IPFS_NODE.get(contentHash.toString())
  const chunks = []

  for await(const e of stream) { chunks.push(e) }

  return Buffer.concat(chunks)
}

async function cacheIPFSContent(
  contentHash: types.CIDContentHash, 
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

async function pinIPFSContent(contentHash: types.CIDContentHash): Promise<boolean> {
  const clientRequest = await IPFS_NODE.pin.add(contentHash.toString())

  return contentHash.cid === clientRequest.cid
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
}

async function getHiddenService(contentHash: types.CIDContentHash): Promise<string> {
  let onionAddress
 
  try {
    onionAddress = await TOR_NODE.getOnionAddress(contentHash.toString())   
 
    if(!onionAddress) {
      await createHiddenService(contentHash)

      onionAddress = await TOR_NODE.getOnionAddress(contentHash.toString())   
    }
  } catch (e) { console.log(e) } 
  
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
  const matchingService = activeServices.find((e:any) => e.hostname == onionAddress)

  return matchingService
}

async function handleWildcardOnions(
  req: types.Request,
  res: types.Response
) {
  const ipfsHash = await getContentHashFromOnionAddress(req.hostname)
  
  if(ipfsHash) {
    const dynamicOnionPath = path.join(
      path.resolve(), 'cache', ipfsHash
    )  

    ONION_SERVER.use(express.static(dynamicOnionPath))
    res.sendFile('index.html', { root: dynamicOnionPath })
  
    return
  } else {
    res.send(message.ERR_REVERSE_ONION)
  }
}

async function handleWildcardPropogation(
  req: types.Request,
  res: types.Response
) {
  const hostName = req.hostname
  const serveOnions = hostName.includes('onion.')
  const ensLabel = parseENSDomain(hostName)
  const ensDomain = ensLabel + '.eth'

  try {
    const { type, payload } = await getContentHash(ensDomain)
    const ipfsContentHash = payload

    if (!(type === 'ipfs' || type === 'ipns')) {
      res.send(message.ERR_UNSUPPORTED_TYPE) 
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
      res.send(message.ERR_NO_STATIC_CONTENT)
      return
    }

    if (serveOnions) {
      const onionAddress = await getHiddenService(ipfsContentHash)

      if(onionAddress) { 
	     res.redirect(`http://${onionAddress}`)
      } else {
	     res.send(message.ERR_NO_ONION_SERVICE)
      }
      return
    } else { 
      SERVER.use(express.static(contentPath))  
      res.sendFile('index.html', { root: contentPath })
      
      return
    }
  } catch (e) {
    res.send(message.ERR_RESOLVE_CONFLICT)
    console.log(e)

    return
  }
}

SERVER.use(express.urlencoded({ extended: true }))
SERVER.use(express.json())
SERVER.use(express.raw())
SERVER.use(cors())

ONION_SERVER.get('/', handleWildcardOnions)
SERVER.get('/', handleWildcardPropogation)
 
SERVER.listen(config.SERVER_PORT, async() => {
  try {
    await startResolver()
    console.log(message.SERVER_INIT) 
  } catch (e) {
    console.log(message.SERVER_FAIL)
    console.log(e)
  }
})
