import { parseAbi } from 'abitype'

import { getCode } from '../../../actions/public/getCode.js'
import { readContract } from '../../../actions/public/readContract.js'
import type { Prettify } from '../../../types/utils.js'
import { getAction } from '../../../utils/getAction.js'
import { createNonceManager } from '../../../utils/nonceManager.js'
import { serializeErc6492Signature } from '../../../utils/signature/serializeErc6492Signature.js'
import { nonceManagerPredeployAddress } from './address.js'
import type {
  NativeSmartAccount,
  NativeSmartAccountImplementation,
} from './types.js'

export type ToNativeSmartAccountParameters<extend extends object = object> =
  NativeSmartAccountImplementation<extend>

export type ToNativeSmartAccountReturnType<
  implementation extends
    NativeSmartAccountImplementation = NativeSmartAccountImplementation,
> = Prettify<NativeSmartAccount<implementation>>

/**
 * @description Creates a Smart Account with a provided account implementation.
 *
 * @param parameters - {@link ToNativeSmartAccountParameters}
 * @returns A RIP-7560 Smart Account. {@link ToNativeSmartAccountReturnType}
 */
export async function toNativeSmartAccount<
  implementation extends NativeSmartAccountImplementation,
>(
  implementation: implementation,
): Promise<ToNativeSmartAccountReturnType<implementation>> {
  const {
    extend,
    nonceKeyManager = createNonceManager({
      source: {
        get() {
          return Date.now()
        },
        set() {},
      },
    }),
    ...rest
  } = implementation

  let deployed = false

  const address = await implementation.getAddress()

  return {
    ...extend,
    ...rest,
    address,
    async getDeployerArgs() {
      if ('isDeployed' in this && (await this.isDeployed()))
        return { deployer: undefined, deployerData: undefined }
      return implementation.getDeployerArgs()
    },
    async getNonce(parameters) {
      const key =
        parameters?.key ??
        BigInt(
          await nonceKeyManager.consume({
            address,
            chainId: implementation.client.chain!.id!,
            client: implementation.client,
          }),
        )

      if (implementation.getNonce)
        return await implementation.getNonce({ ...parameters, key })

      const nonce = await readContract(implementation.client, {
        abi: parseAbi([
          'function getNonce(address, uint192) pure returns (uint256)',
        ]),
        address: nonceManagerPredeployAddress,
        functionName: 'getNonce',
        args: [address, key],
      })
      return nonce
    },
    async isDeployed() {
      if (deployed) return true
      const code = await getAction(
        implementation.client,
        getCode,
        'getCode',
      )({
        address,
      })
      deployed = Boolean(code)
      return deployed
    },
    ...(implementation.sign
      ? {
          async sign(parameters) {
            const [{ deployer, deployerData }, signature] = await Promise.all([
              this.getDeployerArgs(),
              implementation.sign!(parameters),
            ])
            if (deployer && deployerData)
              return serializeErc6492Signature({
                address: deployer,
                data: deployerData,
                signature,
              })
            return signature
          },
        }
      : {}),
    async signMessage(parameters) {
      const [{ deployer, deployerData }, signature] = await Promise.all([
        this.getDeployerArgs(),
        implementation.signMessage(parameters),
      ])
      if (deployer && deployerData)
        return serializeErc6492Signature({
          address: deployer,
          data: deployerData,
          signature,
        })
      return signature
    },
    async signTypedData(parameters) {
      const [{ deployer, deployerData }, signature] = await Promise.all([
        this.getDeployerArgs(),
        implementation.signTypedData(parameters),
      ])
      if (deployer && deployerData)
        return serializeErc6492Signature({
          address: deployer,
          data: deployerData,
          signature,
        })
      return signature
    },
    type: 'native-smart',
  } as ToNativeSmartAccountReturnType<implementation>
}
