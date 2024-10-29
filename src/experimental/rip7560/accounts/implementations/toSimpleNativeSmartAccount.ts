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
  bundlerClient?: Client
  owner: LocalAccount
  nonce?: bigint | undefined
}

export type ToSimpleNativeSmartAccountReturnType = Prettify<
  NativeSmartAccount<SimpleNativeSmartAccountImplementation>
>

export type SimpleNativeSmartAccountImplementation = Assign<
  NativeSmartAccountImplementation<{
    abi: typeof abi
    deployer: { abi: typeof deployerAbi; address: Address }
  }>,
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
  const { client, bundlerClient, owner, nonce = 0n } = parameters

  let address = parameters.address
  const ownerAddr = owner.address as Hex

  const deployer = {
    abi: deployerAbi,
    // TODO: Change this after the deployer contract is deployed. Now copied from Coinbase Wallet
    address: '0x0ba5ed0c6aa8c49038f819e587e2633c4a9f428a',
  } as const

  return toNativeSmartAccount({
    client,
    bundlerClient,
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
        return result.args[0].map((target, index) => ({
          to: target,
          value: result.args[1][index],
          data: result.args[2][index],
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
          calls.map((call) => call.to),
          calls.map((call) => call.value ?? 0n),
          calls.map((call) => call.data ?? '0x'),
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

const abi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  { type: 'receive', stateMutability: 'payable' },
  {
    type: 'function',
    name: 'UPGRADE_INTERFACE_VERSION',
    inputs: [],
    outputs: [{ name: '', type: 'string', internalType: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: '_packValidationData',
    inputs: [
      { name: 'magicValue', type: 'bytes4', internalType: 'bytes4' },
      { name: 'validUntil', type: 'uint48', internalType: 'uint48' },
      { name: 'validAfter', type: 'uint48', internalType: 'uint48' },
    ],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'execute',
    inputs: [
      { name: 'dest', type: 'address', internalType: 'address' },
      { name: 'value', type: 'uint256', internalType: 'uint256' },
      { name: 'func', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'executeBatch',
    inputs: [
      { name: 'dest', type: 'address[]', internalType: 'address[]' },
      { name: 'value', type: 'uint256[]', internalType: 'uint256[]' },
      { name: 'func', type: 'bytes[]', internalType: 'bytes[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'initialize',
    inputs: [{ name: 'anOwner', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'proxiableUUID',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'upgradeToAndCall',
    inputs: [
      { name: 'newImplementation', type: 'address', internalType: 'address' },
      { name: 'data', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'validateTransaction',
    inputs: [
      { name: 'version', type: 'uint256', internalType: 'uint256' },
      { name: 'txHash', type: 'bytes32', internalType: 'bytes32' },
      { name: 'transaction', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'Initialized',
    inputs: [
      {
        name: 'version',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SimpleAccount7560Initialized',
    inputs: [
      {
        name: 'entryPoint',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'owner',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Upgraded',
    inputs: [
      {
        name: 'implementation',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'error',
    name: 'AddressEmptyCode',
    inputs: [{ name: 'target', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ECDSAInvalidSignature', inputs: [] },
  {
    type: 'error',
    name: 'ECDSAInvalidSignatureLength',
    inputs: [{ name: 'length', type: 'uint256', internalType: 'uint256' }],
  },
  {
    type: 'error',
    name: 'ECDSAInvalidSignatureS',
    inputs: [{ name: 's', type: 'bytes32', internalType: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'ERC1967InvalidImplementation',
    inputs: [
      { name: 'implementation', type: 'address', internalType: 'address' },
    ],
  },
  { type: 'error', name: 'ERC1967NonPayable', inputs: [] },
  { type: 'error', name: 'FailedCall', inputs: [] },
  { type: 'error', name: 'InvalidInitialization', inputs: [] },
  { type: 'error', name: 'NotInitializing', inputs: [] },
  { type: 'error', name: 'UUPSUnauthorizedCallContext', inputs: [] },
  {
    type: 'error',
    name: 'UUPSUnsupportedProxiableUUID',
    inputs: [{ name: 'slot', type: 'bytes32', internalType: 'bytes32' }],
  },
] as const

const deployerAbi = [
  {
    type: 'constructor',
    inputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'accountImplementation',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract SimpleAccount_7560',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'createAccount',
    inputs: [
      {
        name: 'owner',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'salt',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: 'ret',
        type: 'address',
        internalType: 'contract SimpleAccount_7560',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getAddress',
    inputs: [
      {
        name: 'owner',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'salt',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
] as const
