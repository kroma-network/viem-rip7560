import type { Address, TypedData } from 'abitype'

import type { LocalAccount } from '../../../../accounts/types.js'
import { readContract } from '../../../../actions/public/readContract.js'
import type { Client } from '../../../../clients/createClient.js'
import { BaseError } from '../../../../errors/base.js'
import type { Hash, Hex } from '../../../../types/misc.js'
import type { TransactionSerializable } from '../../../../types/transaction.js'
import type { TypedDataDefinition } from '../../../../types/typedData.js'
import type { Assign, Prettify } from '../../../../types/utils.js'
import { decodeFunctionData } from '../../../../utils/abi/decodeFunctionData.js'
import { encodeFunctionData } from '../../../../utils/abi/encodeFunctionData.js'
import { keccak256, serializeTransaction } from '../../../../utils/index.js'
import { hashMessage } from '../../../../utils/signature/hashMessage.js'
import { hashTypedData } from '../../../../utils/signature/hashTypedData.js'
import { toNativeSmartAccount } from '../toNativeSmartAccount.js'
import type {
  NativeSmartAccount,
  NativeSmartAccountImplementation,
} from '../types.js'

export type ToSimpleNativeSmartAccountParameters = {
  address?: Address | undefined
  client: Client
  owner: LocalAccount
  nonce?: bigint | undefined
}

export type ToSimpleNativeSmartAccountReturnType = Prettify<
  NativeSmartAccount<SimpleNativeSmartAccountImplementation>
>

export type SimpleNativeSmartAccountImplementation = Assign<
  NativeSmartAccountImplementation,
  {
    decodeCalls: NonNullable<NativeSmartAccountImplementation['decodeCalls']>
    sign: NonNullable<NativeSmartAccountImplementation['sign']>
  }
>

/**
 * @description Create a Simple Native Smart Account.
 *
 * @param parameters - {@link ToSimpleNativeSmartAccountParameters}
 * @returns Simple Native Smart Account. {@link ToSimpleNativeSmartAccountReturnType}
 *
 * @example
 * import { toSimpleNativeSmartAccount } from 'viem/experimental/rip7560'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { client } from './client.js'
 *
 * const account = toSimpleNativeSmartAccount({
 *   client,
 *   owner: privateKeyToAccount('0x...'),
 * })
 */
export async function toSimpleNativeSmartAccount(
  parameters: ToSimpleNativeSmartAccountParameters,
): Promise<ToSimpleNativeSmartAccountReturnType> {
  const { client, owner, nonce = 0n } = parameters

  let address = parameters.address
  const ownerAddr = owner.address as Hex

  const deployer = {
    abi: deployerAbi,
    // TODO: Change this after the deployer contract is deployed. Now copied from Coinbase Wallet
    address: '0x0ba5ed0c6aa8c49038f819e587e2633c4a9f428a',
  } as const

  return toNativeSmartAccount({
    client,

    extend: { abi, deployer },

    async decodeCalls(data) {
      const result = decodeFunctionData({
        abi,
        data,
      })

      if (result.functionName === 'execute')
        return [
          { to: result.args[0], value: result.args[1], data: result.args[2] },
        ]
      if (result.functionName === 'executeBatch')
        return result.args[0].map((arg) => ({
          to: arg.target,
          value: arg.value,
          data: arg.data,
        }))
      throw new BaseError(`unable to decode calls for "${result.functionName}"`)
    },

    async encodeCalls(calls) {
      if (calls.length === 1)
        return encodeFunctionData({
          abi,
          functionName: 'execute',
          args: [calls[0].to, calls[0].value ?? 0n, calls[0].data ?? '0x'],
        })
      return encodeFunctionData({
        abi,
        functionName: 'executeBatch',
        args: [
          calls.map((call) => ({
            data: call.data ?? '0x',
            target: call.to,
            value: call.value ?? 0n,
          })),
        ],
      })
    },

    async getAddress() {
      address ??= await readContract(client, {
        ...deployer,
        functionName: 'getAddress',
        args: [ownerAddr, nonce],
      })
      return address
    },

    async getDeployerArgs() {
      const deployerData = encodeFunctionData({
        abi: deployer.abi,
        functionName: 'createAccount',
        args: [ownerAddr, nonce],
      })
      return { deployer: deployer.address, deployerData }
    },

    async getStubSignature() {
      return '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c' as Hex
    },

    async sign(parameters) {
      const address = await this.getAddress()

      const hash = toReplaySafeHash({
        address,
        chainId: client.chain!.id,
        hash: parameters.hash,
      })

      const signature = await sign({ hash, owner })

      return signature
    },

    async signMessage(parameters) {
      const { message } = parameters
      const address = await this.getAddress()

      const hash = toReplaySafeHash({
        address,
        chainId: client.chain!.id,
        hash: hashMessage(message),
      })

      const signature = await sign({ hash, owner })

      return signature
    },

    async signTypedData(parameters) {
      const { domain, types, primaryType, message } =
        parameters as TypedDataDefinition<TypedData, string>
      const address = await this.getAddress()

      const hash = toReplaySafeHash({
        address,
        chainId: client.chain!.id,
        hash: hashTypedData({
          domain,
          message,
          primaryType,
          types,
        }),
      })

      const signature = await sign({ hash, owner })

      return signature
    },

    async signTransaction(parameters) {
      const { chainId = client.chain!.id, ...transaction } = parameters

      const address = await this.getAddress()
      const serializableTransaction = {
        ...transaction,
        sender: address,
        chainId,
      } as TransactionSerializable
      const hash = keccak256(serializeTransaction(serializableTransaction))

      const signature = await sign({ hash, owner })

      return signature
    },

    transaction: {
      async estimateGas(transaction) {
        return {
          verificationGasLimit: BigInt(
            Number(transaction.verificationGasLimit ?? 0n),
          ),
        }
      },
    },
  })
}

/////////////////////////////////////////////////////////////////////////////////////////////
// Utilities
/////////////////////////////////////////////////////////////////////////////////////////////

/** @internal */
export async function sign({
  hash,
  owner,
}: { hash: Hash; owner: LocalAccount }) {
  if (owner.sign) return owner.sign({ hash })

  throw new BaseError('`owner` does not support raw sign.')
}

/** @internal */
export function toReplaySafeHash({
  address,
  chainId,
  hash,
}: { address: Address; chainId: number; hash: Hash }) {
  return hashTypedData({
    domain: {
      chainId,
      name: 'Simple Native Smart Wallet',
      verifyingContract: address,
      version: '1',
    },
    types: {
      SimpleNativeSmartWalletMessage: [
        {
          name: 'hash',
          type: 'bytes32',
        },
      ],
    },
    primaryType: 'SimpleNativeSmartWalletMessage',
    message: {
      hash,
    },
  })
}

/////////////////////////////////////////////////////////////////////////////////////////////
// Constants
/////////////////////////////////////////////////////////////////////////////////////////////

// TODO: Change this after the contract is determined. Now copied from Coinbase Wallet.
const abi = [
  { inputs: [], stateMutability: 'nonpayable', type: 'constructor' },
  {
    inputs: [{ name: 'owner', type: 'bytes' }],
    name: 'AlreadyOwner',
    type: 'error',
  },
  { inputs: [], name: 'Initialized', type: 'error' },
  {
    inputs: [{ name: 'owner', type: 'bytes' }],
    name: 'InvalidEthereumAddressOwner',
    type: 'error',
  },
  {
    inputs: [{ name: 'key', type: 'uint256' }],
    name: 'InvalidNonceKey',
    type: 'error',
  },
  {
    inputs: [{ name: 'owner', type: 'bytes' }],
    name: 'InvalidOwnerBytesLength',
    type: 'error',
  },
  { inputs: [], name: 'LastOwner', type: 'error' },
  {
    inputs: [{ name: 'index', type: 'uint256' }],
    name: 'NoOwnerAtIndex',
    type: 'error',
  },
  {
    inputs: [{ name: 'ownersRemaining', type: 'uint256' }],
    name: 'NotLastOwner',
    type: 'error',
  },
  {
    inputs: [{ name: 'selector', type: 'bytes4' }],
    name: 'SelectorNotAllowed',
    type: 'error',
  },
  { inputs: [], name: 'Unauthorized', type: 'error' },
  { inputs: [], name: 'UnauthorizedCallContext', type: 'error' },
  { inputs: [], name: 'UpgradeFailed', type: 'error' },
  {
    inputs: [
      { name: 'index', type: 'uint256' },
      { name: 'expectedOwner', type: 'bytes' },
      { name: 'actualOwner', type: 'bytes' },
    ],
    name: 'WrongOwnerAtIndex',
    type: 'error',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,

        name: 'index',
        type: 'uint256',
      },
      { indexed: false, name: 'owner', type: 'bytes' },
    ],
    name: 'AddOwner',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,

        name: 'index',
        type: 'uint256',
      },
      { indexed: false, name: 'owner', type: 'bytes' },
    ],
    name: 'RemoveOwner',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,

        name: 'implementation',
        type: 'address',
      },
    ],
    name: 'Upgraded',
    type: 'event',
  },
  { stateMutability: 'payable', type: 'fallback' },
  {
    inputs: [],
    name: 'REPLAYABLE_NONCE_KEY',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'addOwnerAddress',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'x', type: 'bytes32' },
      { name: 'y', type: 'bytes32' },
    ],
    name: 'addOwnerPublicKey',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'functionSelector', type: 'bytes4' }],
    name: 'canSkipChainIdValidation',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [],
    name: 'domainSeparator',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'eip712Domain',
    outputs: [
      { name: 'fields', type: 'bytes1' },
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
      { name: 'salt', type: 'bytes32' },
      { name: 'extensions', type: 'uint256[]' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'entryPoint',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    name: 'execute',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],

        name: 'calls',
        type: 'tuple[]',
      },
    ],
    name: 'executeBatch',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ name: 'calls', type: 'bytes[]' }],
    name: 'executeWithoutChainIdValidation',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { name: 'sender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'initCode', type: 'bytes' },
          { name: 'callData', type: 'bytes' },
          { name: 'callGasLimit', type: 'uint256' },
          {
            name: 'verificationGasLimit',
            type: 'uint256',
          },
          {
            name: 'preVerificationGas',
            type: 'uint256',
          },
          { name: 'maxFeePerGas', type: 'uint256' },
          {
            name: 'maxPriorityFeePerGas',
            type: 'uint256',
          },
          { name: 'paymasterAndData', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],

        name: 'userOp',
        type: 'tuple',
      },
    ],
    name: 'getUserOpHashWithoutChainId',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'implementation',
    outputs: [{ name: '$', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'owners', type: 'bytes[]' }],
    name: 'initialize',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'isOwnerAddress',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'bytes' }],
    name: 'isOwnerBytes',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'x', type: 'bytes32' },
      { name: 'y', type: 'bytes32' },
    ],
    name: 'isOwnerPublicKey',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    name: 'isValidSignature',
    outputs: [{ name: 'result', type: 'bytes4' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'nextOwnerIndex',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'index', type: 'uint256' }],
    name: 'ownerAtIndex',
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'ownerCount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'index', type: 'uint256' },
      { name: 'owner', type: 'bytes' },
    ],
    name: 'removeLastOwner',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'index', type: 'uint256' },
      { name: 'owner', type: 'bytes' },
    ],
    name: 'removeOwnerAtIndex',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'removedOwnersCount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'hash', type: 'bytes32' }],
    name: 'replaySafeHash',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'newImplementation', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { name: 'sender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'initCode', type: 'bytes' },
          { name: 'callData', type: 'bytes' },
          { name: 'callGasLimit', type: 'uint256' },
          {
            name: 'verificationGasLimit',
            type: 'uint256',
          },
          {
            name: 'preVerificationGas',
            type: 'uint256',
          },
          { name: 'maxFeePerGas', type: 'uint256' },
          {
            name: 'maxPriorityFeePerGas',
            type: 'uint256',
          },
          { name: 'paymasterAndData', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],

        name: 'userOp',
        type: 'tuple',
      },
      { name: 'userOpHash', type: 'bytes32' },
      { name: 'missingAccountFunds', type: 'uint256' },
    ],
    name: 'validateUserOp',
    outputs: [{ name: 'validationData', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  { stateMutability: 'payable', type: 'receive' },
] as const

const deployerAbi = [
  {
    inputs: [{ name: 'implementation_', type: 'address' }],
    stateMutability: 'payable',
    type: 'constructor',
  },
  { inputs: [], name: 'OwnerRequired', type: 'error' },
  {
    inputs: [
      { name: 'owners', type: 'address' },
      { name: 'nonce', type: 'uint256' },
    ],
    name: 'createAccount',
    outputs: [
      {
        name: 'account',
        type: 'address',
      },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owners', type: 'address' },
      { name: 'nonce', type: 'uint256' },
    ],
    name: 'getAddress',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'implementation',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'initCodeHash',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const
