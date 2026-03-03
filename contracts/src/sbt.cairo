/// Satoshi Proof SBT (Soulbound Token)
///
/// Non-transferable ERC-721 token minted when a Bitcoin ownership proof is verified.
/// Metadata includes bracket level (Shrimp/Crab/Fish/Shark/Whale).

use starknet::ContractAddress;

#[starknet::interface]
pub trait ISatoshiSBT<TContractState> {
    fn mint_proof_sbt(ref self: TContractState, to: ContractAddress, bracket: u8);
    fn get_bracket(self: @TContractState, token_id: u256) -> u8;
    fn get_token_of(self: @TContractState, owner: ContractAddress) -> u256;
    fn total_minted(self: @TContractState) -> u256;
}

#[starknet::contract]
pub mod SatoshiSBT {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess,
        StoragePointerReadAccess, StoragePointerWriteAccess,
    };

    #[storage]
    struct Storage {
        // Simple SBT: owner → token_id, token_id → bracket
        owner_token: Map<ContractAddress, u256>,
        token_owner: Map<u256, ContractAddress>,
        token_bracket: Map<u256, u8>,
        next_token_id: u256,
        registry: ContractAddress,  // only registry can mint
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        SBTMinted: SBTMinted,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SBTMinted {
        #[key]
        pub to: ContractAddress,
        pub token_id: u256,
        pub bracket: u8,
    }

    #[constructor]
    fn constructor(ref self: ContractState, registry: ContractAddress) {
        self.registry.write(registry);
        self.next_token_id.write(1);
    }

    #[abi(embed_v0)]
    impl SatoshiSBTImpl of super::ISatoshiSBT<ContractState> {
        fn mint_proof_sbt(ref self: ContractState, to: ContractAddress, bracket: u8) {
            // Only registry can mint
            let caller = get_caller_address();
            assert!(caller == self.registry.read(), "Only registry can mint");
            assert!(bracket <= 4, "Invalid bracket");

            let token_id = self.next_token_id.read();

            // If user already has SBT, update bracket
            let existing = self.owner_token.read(to);
            if existing > 0 {
                self.token_bracket.write(existing, bracket);
                self.emit(SBTMinted { to, token_id: existing, bracket });
                return;
            }

            self.owner_token.write(to, token_id);
            self.token_owner.write(token_id, to);
            self.token_bracket.write(token_id, bracket);
            self.next_token_id.write(token_id + 1);

            self.emit(SBTMinted { to, token_id, bracket });
        }

        fn get_bracket(self: @ContractState, token_id: u256) -> u8 {
            self.token_bracket.read(token_id)
        }

        fn get_token_of(self: @ContractState, owner: ContractAddress) -> u256 {
            self.owner_token.read(owner)
        }

        fn total_minted(self: @ContractState) -> u256 {
            self.next_token_id.read() - 1
        }
    }
}
