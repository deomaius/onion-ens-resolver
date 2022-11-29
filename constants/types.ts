import type * as client from "express"
import type * as http from "http"

import { CID } from 'multiformats/cid'

export type CIDContentHash = typeof CID
export type Response = client.Response
export type Request = client.Request