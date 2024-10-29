import { defineChain } from '../../utils/chain/defineChain.js'
import { chainConfig } from '../../zksync/chainConfig.js'

export const kromaPioneer = /*#__PURE__*/ defineChain({
  ...chainConfig,
  id: 11171168,
  name: 'Pioneer Alpha',
  network: 'pioneer-alpha',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: ['https://api.pioneer.kroma.network'],
      webSocket: ['wss://api.pioneer.kroma.network'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: 'https://blockscout.pioneer.kroma.network/',
      apiUrl: 'https://blockscout.pioneer.kroma.network/api',
    },
    native: {
      name: 'Pioneer Explorer',
      url: 'https://blockscout.pioneer.kroma.network/',
      apiUrl: 'https://blockscout.pioneer.kroma.network/api',
    },
  },
  contracts: {
    multicall3: {
      address: '0xca11bde05977b3631167028862be2a173976ca11',
    },
  },
})
