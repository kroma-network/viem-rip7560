import type { Hex } from '../../../types/misc.js'

export type Calls<uint256 = bigint> = {
  to: Hex
  data?: Hex | undefined
  value?: uint256 | undefined
}
