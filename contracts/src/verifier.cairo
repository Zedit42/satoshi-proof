/// Bitcoin Signature Verifier
///
/// Verifies Bitcoin message signatures on Starknet using the native secp256k1 syscall.
/// Supports BIP-137 signed messages (legacy P2PKH format).
///
/// Bitcoin message hash format:
///   SHA256(SHA256("\x18Bitcoin Signed Message:\n" + varint(len) + message))
///
/// Since SHA-256 is expensive in Cairo, we compute the message hash off-chain
/// and verify the ECDSA signature on-chain using secp256k1 recover.

use starknet::ContractAddress;
use starknet::secp256k1::Secp256k1Point;
use starknet::secp256_trait::{Signature, recover_public_key, is_valid_signature};

#[starknet::interface]
pub trait IBitcoinVerifier<TContractState> {
    /// Verify a Bitcoin message signature and recover the public key.
    /// Returns the recovered public key coordinates (x, y) if valid.
    /// msg_hash: SHA256d of the Bitcoin signed message (computed off-chain)
    /// sig_r, sig_s: ECDSA signature components (u256)
    /// y_parity: recovery flag (derived from BIP-137 header byte)
    fn verify_bitcoin_sig(
        self: @TContractState,
        msg_hash: u256,
        sig_r: u256,
        sig_s: u256,
        y_parity: bool,
    ) -> (u256, u256);

    /// Check if a signature is valid for a given public key
    fn check_bitcoin_sig(
        self: @TContractState,
        msg_hash: u256,
        sig_r: u256,
        sig_s: u256,
        pub_x: u256,
        pub_y: u256,
    ) -> bool;
}

#[starknet::contract]
pub mod BitcoinVerifier {
    use starknet::secp256k1::Secp256k1Point;
    use starknet::secp256_trait::{
        Signature, Secp256Trait, Secp256PointTrait, recover_public_key, is_valid_signature,
    };
    use starknet::SyscallResultTrait;

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl BitcoinVerifierImpl of super::IBitcoinVerifier<ContractState> {
        fn verify_bitcoin_sig(
            self: @ContractState,
            msg_hash: u256,
            sig_r: u256,
            sig_s: u256,
            y_parity: bool,
        ) -> (u256, u256) {
            let signature = Signature { r: sig_r, s: sig_s, y_parity };

            let recovered = recover_public_key::<Secp256k1Point>(msg_hash, signature)
                .expect('Recovery failed');

            let (x, y) = recovered.get_coordinates().unwrap_syscall();
            (x, y)
        }

        fn check_bitcoin_sig(
            self: @ContractState,
            msg_hash: u256,
            sig_r: u256,
            sig_s: u256,
            pub_x: u256,
            pub_y: u256,
        ) -> bool {
            let public_key = Secp256Trait::<Secp256k1Point>::secp256_ec_new_syscall(pub_x, pub_y)
                .unwrap_syscall()
                .expect('Invalid public key');

            is_valid_signature::<Secp256k1Point>(msg_hash, sig_r, sig_s, public_key)
        }
    }
}
