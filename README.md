# ENS IPFS Resolver

A Node.js server that resolves ENS domains to IPFS content and provides Tor hidden service support for decentralized web hosting.

## Features

- Resolves ENS domains to IPFS/IPNS content
- Automatic SSL certificate management with Let's Encrypt
- Tor hidden service creation and management
- Content caching and pinning
- Rate limiting for DDoS protection
- Support for static web content

## Prerequisites

- Node.js
- Tor daemon
- IPFS node
- SSL certificates for root domain
- DNS configuration for domain

## Configuration

The server requires a `config.js` file with the following parameters:

- `IFPS_NODE_ENDPOINT`: URL of IPFS node
- `RPC_PROVIDER`: Ethereum RPC provider URL
- `TOR_PATH`: Path to Tor executable
- `TOR_BRIDGES`: Tor bridge configuration
- `ONION_PORT`: Port for Tor hidden services
- `PATH_SSL_KEY`: Path to SSL private key
- `PATH_SSL_CERT`: Path to SSL certificate
- `DNS_CHALLENGE_PARAMS`: DNS challenge parameters for Let's Encrypt
- `GLOCK_CONFIG`: Greenlock SSL configuration
- `GLOCK_DEFAULTS`: Default Greenlock settings

## How It Works

1. **ENS Resolution**:
   - Receives requests to `*.3th.ws` domains
   - Resolves ENS names to IPFS/IPNS content hashes
   - Fetches content from IPFS network

2. **Content Management**:
   - Caches IPFS content locally
   - Pins content to configured IPFS node
   - Serves static HTML content
   - Cleans up unused cached content

3. **Hidden Services**:
   - Creates Tor hidden services for IPFS content
   - Manages onion addresses
   - Handles reverse resolution of onion addresses

4. **SSL Management**:
   - Automatic certificate generation and renewal
   - Wildcard certificate support using [greenlock.js]()
   - Domain-specific certificate handling

## Usage

1. Start the server:
```bash
node server.js
```

2. Access content via:
   - Direct domain: `https://your-ens-name.[YOUR_TLD_NAME].[TLD]`
   - Onion service: `https://onion.your-ens-name.[YOUR_TLD_NAME].[TLD]`

## Error Handling

The server provides various error messages for common scenarios:
- Failed content fetching
- Unsupported content types
- Missing static content
- Resolution conflicts
- Hidden service errors

## Security Features

- Rate limiting to prevent abuse
- SSL/TLS encryption
- Tor network integration
- Content validation
- Error handling and logging

## Contributing

Feel free to submit issues and enhancement requests. Follow standard GitHub pull request process for contributions.

## License

MIT jazz
