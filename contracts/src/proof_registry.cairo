/// Proof Registry — Records verified Bitcoin ownership proofs on-chain
///
/// Flow:
/// 1. User signs a message with their BTC wallet (off-chain)
/// 2. Frontend computes msg_hash + recovers pubkey (off-chain)
/// 3. User submits proof on-chain: (msg_hash, sig, expected_pubkey_hash, bracket)
/// 4. Contract verifies secp256k1 signature via syscall
/// 5. Contract recovers pubkey → hashes to btc_pubkey_hash
/// 6. If valid → stores proof + emits event
///
/// Brackets: 0=Shrimp(<1), 1=Crab(1-10), 2=Fish(10-50), 3=Shark(50-100), 4=Whale(100+)

use starknet::ContractAddress;

#[starknet::interface]
pub trait IProofRegistry<TContractState> {
    fn register_proof(
        ref self: TContractState,
        msg_hash: u256,
        sig_r: u256,
        sig_s: u256,
        y_parity: bool,
        btc_pubkey_hash: felt252,  // hash of the BTC public key (privacy: no raw pubkey stored)
        bracket: u8,               // 0-4
        expiry_days: u64,          // proof validity in days (0 = 30 days default)
    );
    fn get_proof(self: @TContractState, owner: ContractAddress) -> (felt252, u8, u64, u64, bool);
    fn has_valid_proof(self: @TContractState, owner: ContractAddress, min_bracket: u8) -> bool;
    fn get_proof_count(self: @TContractState) -> u64;
    fn revoke_proof(ref self: TContractState);
}

#[starknet::contract]
pub mod ProofRegistry {
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess,
        StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::secp256k1::Secp256k1Point;
    use starknet::secp256_trait::{
        Signature, Secp256PointTrait, recover_public_key,
    };
    use starknet::SyscallResultTrait;
    use core::poseidon::PoseidonTrait;
    use core::hash::HashStateTrait;

    #[storage]
    struct Storage {
        // owner → proof data
        proof_pubkey_hash: Map<ContractAddress, felt252>,
        proof_bracket: Map<ContractAddress, u8>,
        proof_timestamp: Map<ContractAddress, u64>,
        proof_valid: Map<ContractAddress, bool>,
        proof_expires_at: Map<ContractAddress, u64>,
        proof_count: u64,
        // replay protection: msg_hash → used
        used_msg_hashes: Map<u256, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ProofRegistered: ProofRegistered,
        ProofRevoked: ProofRevoked,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ProofRegistered {
        #[key]
        pub owner: ContractAddress,
        pub btc_pubkey_hash: felt252,
        pub bracket: u8,
        pub timestamp: u64,
        pub expires_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ProofRevoked {
        #[key]
        pub owner: ContractAddress,
    }

    #[abi(embed_v0)]
    impl ProofRegistryImpl of super::IProofRegistry<ContractState> {
        fn register_proof(
            ref self: ContractState,
            msg_hash: u256,
            sig_r: u256,
            sig_s: u256,
            y_parity: bool,
            btc_pubkey_hash: felt252,
            bracket: u8,
            expiry_days: u64,
        ) {
            assert!(bracket <= 4, "Invalid bracket (0-4)");

            // Expiry: 0 = default 30 days, max 365 days
            let days = if expiry_days == 0 { 30_u64 } else { expiry_days };
            assert!(days <= 365, "Max expiry is 365 days");

            // 0. Check replay protection BEFORE verification
            assert!(!self.used_msg_hashes.read(msg_hash), "Signature already used");

            // 1. Recover public key from signature
            let signature = Signature { r: sig_r, s: sig_s, y_parity };
            let recovered = recover_public_key::<Secp256k1Point>(msg_hash, signature)
                .expect('Signature recovery failed');

            let (pub_x, pub_y) = recovered.get_coordinates().unwrap_syscall();

            // 2. Hash recovered pubkey → compare with claimed hash
            let computed_hash = PoseidonTrait::new()
                .update(pub_x.low.into())
                .update(pub_x.high.into())
                .update(pub_y.low.into())
                .update(pub_y.high.into())
                .finalize();

            assert!(computed_hash == btc_pubkey_hash, "Pubkey hash mismatch");

            // 3. Mark signature as used AFTER successful verification
            self.used_msg_hashes.write(msg_hash, true);

            // 4. Store proof with expiry
            let caller = get_caller_address();
            let now = get_block_timestamp();
            let expires_at = now + (days * 86400); // days → seconds

            self.proof_pubkey_hash.write(caller, btc_pubkey_hash);
            self.proof_bracket.write(caller, bracket);
            self.proof_timestamp.write(caller, now);
            self.proof_expires_at.write(caller, expires_at);
            self.proof_valid.write(caller, true);

            let count = self.proof_count.read();
            self.proof_count.write(count + 1);

            self.emit(ProofRegistered {
                owner: caller,
                btc_pubkey_hash,
                bracket,
                timestamp: now,
                expires_at,
            });
        }

        fn get_proof(self: @ContractState, owner: ContractAddress) -> (felt252, u8, u64, u64, bool) {
            let is_valid = self.proof_valid.read(owner);
            let expires_at = self.proof_expires_at.read(owner);
            let now = get_block_timestamp();
            // Auto-expire: if past expiry, treat as invalid
            let effective_valid = is_valid && (expires_at == 0 || now < expires_at);

            (
                self.proof_pubkey_hash.read(owner),
                self.proof_bracket.read(owner),
                self.proof_timestamp.read(owner),
                expires_at,
                effective_valid,
            )
        }

        fn has_valid_proof(self: @ContractState, owner: ContractAddress, min_bracket: u8) -> bool {
            let is_valid = self.proof_valid.read(owner);
            let bracket = self.proof_bracket.read(owner);
            let expires_at = self.proof_expires_at.read(owner);
            let now = get_block_timestamp();
            // Check expiry
            let not_expired = expires_at == 0 || now < expires_at;
            is_valid && not_expired && bracket >= min_bracket
        }

        fn get_proof_count(self: @ContractState) -> u64 {
            self.proof_count.read()
        }

        fn revoke_proof(ref self: ContractState) {
            let caller = get_caller_address();
            self.proof_valid.write(caller, false);
            self.emit(ProofRevoked { owner: caller });
        }
    }
}
