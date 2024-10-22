// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@rip7560/contracts/interfaces/IRip7560Transaction.sol";
import "@rip7560/contracts/utils/RIP7560Utils.sol";
import "@rip7560/contracts/interfaces/IRip7560Account.sol";

contract SimpleAccount_7560 is UUPSUpgradeable, Initializable {
    using MessageHashUtils for bytes32;
    using ECDSA for bytes32;

    bytes4 constant MAGIC_VALUE_SENDER = 0xbf45c166;

    bytes4 constant MAGIC_VALUE_SIGFAIL = 0x31665494;

    address private constant _entryPoint =
        0x0000000000000000000000000000000000007560;

    address public owner;

    event SimpleAccount7560Initialized(
        address indexed entryPoint,
        address indexed owner
    );

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

    constructor() {
        _disableInitializers();
    }

    function _onlyOwner() internal view {
        //directly from EOA owner, or through the account itself (which gets redirected through execute())
        require(
            msg.sender == owner || msg.sender == address(this),
            "only owner"
        );
    }

    function initialize(address anOwner) public virtual initializer {
        _initialize(anOwner);
    }

    function _initialize(address anOwner) internal virtual {
        owner = anOwner;
        emit SimpleAccount7560Initialized(_entryPoint, owner);
    }

    function validateTransaction(
        uint256 version,
        bytes32 txHash,
        bytes calldata transaction
    ) public view returns (bytes32) {
        (version);
        _requireFromEntryPoint();
        return _validateSignature(txHash, transaction);
    }

    function execute(
        address dest,
        uint256 value,
        bytes calldata func
    ) external {
        _requireFromEntryPointOrOwner();
        _call(dest, value, func);
    }

    function executeBatch(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) external {
        _requireFromEntryPointOrOwner();
        require(
            dest.length == func.length &&
                (value.length == 0 || value.length == func.length),
            "wrong array lengths"
        );
        if (value.length == 0) {
            for (uint256 i = 0; i < dest.length; i++) {
                _call(dest[i], 0, func[i]);
            }
        } else {
            for (uint256 i = 0; i < dest.length; i++) {
                _call(dest[i], value[i], func[i]);
            }
        }
    }

    function _validateSignature(
        bytes32 txHash,
        bytes calldata transaction
    ) internal view returns (bytes32) {
        RIP7560Transaction memory _tx = RIP7560Utils.decodeTransaction(
            RIP7560Utils.VERSION,
            transaction
        );
        bytes32 hash = txHash.toEthSignedMessageHash();
        if (owner != hash.recover(_tx.authorizationData)) {
            return _packValidationData(MAGIC_VALUE_SIGFAIL, 0, 0);
        }
        return _packValidationData(MAGIC_VALUE_SENDER, 0, 0);
    }

    function _call(address target, uint256 value, bytes memory data) internal {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    function _requireFromEntryPoint() internal view virtual {
        require(
            msg.sender == 0x0000000000000000000000000000000000007560,
            "account: not from EntryPoint"
        );
    }

    function _requireFromEntryPointOrOwner() internal view {
        require(
            msg.sender == _entryPoint || msg.sender == owner,
            "account: not Owner or EntryPoint"
        );
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal view override {
        (newImplementation);
        _onlyOwner();
    }

    function _packValidationData(
        bytes4 magicValue,
        uint48 validUntil,
        uint48 validAfter
    ) public pure returns (bytes32) {
        return
            bytes32(
                uint256(uint32(magicValue)) |
                    ((uint256(validUntil)) << 160) |
                    (uint256(validAfter) << (160 + 48))
            );
    }
}
