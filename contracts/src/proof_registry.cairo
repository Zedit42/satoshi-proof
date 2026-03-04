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
///
/// Expiry: Proofs are permanent. Applications decide freshness via max_age_seconds
/// in has_valid_proof_with_age(). Default has_valid_proof() has no age limit.
///
/// Access Control: OwnableTwoStep (owner can pause/unpause, admin-revoke proofs)

use starknet::ContractAddress;

#[starknet::interface]
pub trait IProofRegistry<TContractState> {
    fn register_proof(
        ref self: TContractState,
        msg_hash: u256,
        sig_r: u256,
        sig_s: u256,
        y_parity: bool,
        btc_pubkey_hash: felt252,
        salt: felt252,            // random salt for rainbow table protection
        bracket: u8,
        encrypted_btc_addr: ByteArray,
    );
    fn get_proof(self: @TContractState, owner: ContractAddress) -> (felt252, u8, u64, bool);
    fn get_encrypted_btc_addr(self: @TContractState, owner: ContractAddress) -> ByteArray;
    fn has_valid_proof(self: @TContractState, owner: ContractAddress, min_bracket: u8) -> bool;
    fn has_valid_proof_with_age(
        self: @TContractState,
        owner: ContractAddress,
        min_bracket: u8,
        max_age_seconds: u64,
    ) -> bool;
    fn get_proof_count(self: @TContractState) -> u64;
    fn revoke_proof(ref self: TContractState);
    // Admin functions
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
    fn is_paused(self: @TContractState) -> bool;
    fn admin_revoke_proof(ref self: TContractState, user: ContractAddress);
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
    use openzeppelin_access::ownable::OwnableComponent;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        proof_pubkey_hash: Map<ContractAddress, felt252>,
        proof_bracket: Map<ContractAddress, u8>,
        proof_timestamp: Map<ContractAddress, u64>,
        proof_valid: Map<ContractAddress, bool>,
        proof_encrypted_addr: Map<ContractAddress, ByteArray>,
        proof_count: u64,
        used_msg_hashes: Map<u256, bool>,
        paused: bool,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        ProofRegistered: ProofRegistered,
        ProofRevoked: ProofRevoked,
        Paused: Paused,
        Unpaused: Unpaused,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ProofRegistered {
        #[key]
        pub owner: ContractAddress,
        pub btc_pubkey_hash: felt252,
        pub bracket: u8,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ProofRevoked {
        #[key]
        pub owner: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Paused {}

    #[derive(Drop, starknet::Event)]
    pub struct Unpaused {}

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
        self.paused.write(false);
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
            salt: felt252,
            bracket: u8,
            encrypted_btc_addr: ByteArray,
        ) {
            assert!(!self.paused.read(), "Contract is paused");
            assert!(bracket <= 4, "Invalid bracket (0-4)");
            assert!(!self.used_msg_hashes.read(msg_hash), "Signature already used");

            let signature = Signature { r: sig_r, s: sig_s, y_parity };
            let recovered = recover_public_key::<Secp256k1Point>(msg_hash, signature)
                .expect('Signature recovery failed');

            let (pub_x, pub_y) = recovered.get_coordinates().unwrap_syscall();

            // Salted Poseidon hash — prevents rainbow table attacks on pubkey
            let computed_hash = PoseidonTrait::new()
                .update(pub_x.low.into())
                .update(pub_x.high.into())
                .update(pub_y.low.into())
                .update(pub_y.high.into())
                .update(salt)
                .finalize();

            assert!(computed_hash == btc_pubkey_hash, "Pubkey hash mismatch");

            self.used_msg_hashes.write(msg_hash, true);

            let caller = get_caller_address();
            let now = get_block_timestamp();

            self.proof_pubkey_hash.write(caller, btc_pubkey_hash);
            self.proof_bracket.write(caller, bracket);
            self.proof_timestamp.write(caller, now);
            self.proof_valid.write(caller, true);
            self.proof_encrypted_addr.write(caller, encrypted_btc_addr);

            let count = self.proof_count.read();
            self.proof_count.write(count + 1);

            self.emit(ProofRegistered {
                owner: caller,
                btc_pubkey_hash,
                bracket,
                timestamp: now,
            });
        }

        fn get_proof(self: @ContractState, owner: ContractAddress) -> (felt252, u8, u64, bool) {
            (
                self.proof_pubkey_hash.read(owner),
                self.proof_bracket.read(owner),
                self.proof_timestamp.read(owner),
                self.proof_valid.read(owner),
            )
        }

        fn has_valid_proof(self: @ContractState, owner: ContractAddress, min_bracket: u8) -> bool {
            let is_valid = self.proof_valid.read(owner);
            let bracket = self.proof_bracket.read(owner);
            is_valid && bracket >= min_bracket
        }

        fn has_valid_proof_with_age(
            self: @ContractState,
            owner: ContractAddress,
            min_bracket: u8,
            max_age_seconds: u64,
        ) -> bool {
            let is_valid = self.proof_valid.read(owner);
            let bracket = self.proof_bracket.read(owner);
            if !is_valid || bracket < min_bracket {
                return false;
            }
            if max_age_seconds == 0 {
                return true;
            }
            let timestamp = self.proof_timestamp.read(owner);
            let now = get_block_timestamp();
            let age = now - timestamp;
            age <= max_age_seconds
        }

        fn get_encrypted_btc_addr(self: @ContractState, owner: ContractAddress) -> ByteArray {
            self.proof_encrypted_addr.read(owner)
        }

        fn get_proof_count(self: @ContractState) -> u64 {
            self.proof_count.read()
        }

        fn revoke_proof(ref self: ContractState) {
            let caller = get_caller_address();
            self.proof_valid.write(caller, false);
            self.emit(ProofRevoked { owner: caller });
        }

        // ─── Admin Functions (owner only) ───

        fn pause(ref self: ContractState) {
            self.ownable.assert_only_owner();
            assert!(!self.paused.read(), "Already paused");
            self.paused.write(true);
            self.emit(Paused {});
        }

        fn unpause(ref self: ContractState) {
            self.ownable.assert_only_owner();
            assert!(self.paused.read(), "Not paused");
            self.paused.write(false);
            self.emit(Unpaused {});
        }

        fn is_paused(self: @ContractState) -> bool {
            self.paused.read()
        }

        fn admin_revoke_proof(ref self: ContractState, user: ContractAddress) {
            self.ownable.assert_only_owner();
            self.proof_valid.write(user, false);
            self.emit(ProofRevoked { owner: user });
        }
    }
}
