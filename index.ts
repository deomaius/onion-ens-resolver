import type * as client from "express"
import type * as http from "http"

import { Blob } from 'node:buffer'
import { CID } from 'multiformats/cid'

import express from "express"
import dotenv from "dotenv"
import cors from "cors"
import fs from "fs"
import path from "path"

import ths from "ths"
import web3 from "web3"
import * as ipfs from "ipfs-http-client"

import contentHash from "@ensdomains/content-hash"

import config from './constants/config.js'

const NA_IPFS_CONTENT = new Buffer([])
const NODE_ENDPOINT = new URL('http://127.0.0.1:5001')

const IPFS_NODE = ipfs.create({ url: NODE_ENDPOINT })
const TOR_NODE = new ths()
const SERVER = express()
const PORT = 1337

type CIDContentHash = typeof CID

function startResolver() { }

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

function getCachedIPFSContent() {}

async function getIPFSContent(contentHash: CIDContentHash): Promise<Buffer> {
  const stream = await IPFS_NODE.get(contentHash.toString())
  const chunks = []

  for await(const e of stream) {
    chunks.push(e)
  }

  return Buffer.concat(chunks)
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

  const filter = pinnedContent.filter((e: CIDContentHash) => e.cid === contentHash.cid)
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
  req: client.Request,
  res: client.Response
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
    // if (serveOnions) {
    //  const hiddenService = getsHiddenService(ipfsContentHash)
    // res.redirect(hiddenService.onion)
    // } else {   
    res.send(ipfsContent)
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
 
SERVER.listen(PORT, () => console.log('// Resolver ::: on //'))