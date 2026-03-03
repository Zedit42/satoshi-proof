use satoshi_proof::sbt::{ISatoshiSBTDispatcher, ISatoshiSBTDispatcherTrait};
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address, stop_cheat_caller_address};

fn REGISTRY() -> starknet::ContractAddress {
    starknet::contract_address_const::<0xBEEF>()
}

fn USER() -> starknet::ContractAddress {
    starknet::contract_address_const::<0x1234>()
}

fn deploy_sbt() -> ISatoshiSBTDispatcher {
    let class = declare("SatoshiSBT").unwrap().contract_class();
    let registry_felt: felt252 = REGISTRY().into();
    let (addr, _) = class.deploy(@array![registry_felt]).unwrap();
    ISatoshiSBTDispatcher { contract_address: addr }
}

#[test]
fn test_total_minted_starts_zero() {
    let sbt = deploy_sbt();
    assert!(sbt.total_minted() == 0, "should be 0");
}

#[test]
fn test_mint_sbt() {
    let sbt = deploy_sbt();
    start_cheat_caller_address(sbt.contract_address, REGISTRY());
    sbt.mint_proof_sbt(USER(), 3); // Shark
    stop_cheat_caller_address(sbt.contract_address);

    assert!(sbt.total_minted() == 1, "should be 1");
    assert!(sbt.get_token_of(USER()) == 1, "user should have token 1");
    assert!(sbt.get_bracket(1) == 3, "bracket should be Shark (3)");
}

#[test]
fn test_mint_updates_existing() {
    let sbt = deploy_sbt();
    start_cheat_caller_address(sbt.contract_address, REGISTRY());
    sbt.mint_proof_sbt(USER(), 2); // Fish
    sbt.mint_proof_sbt(USER(), 4); // upgrade to Whale
    stop_cheat_caller_address(sbt.contract_address);

    assert!(sbt.total_minted() == 1, "still 1 token");
    assert!(sbt.get_bracket(1) == 4, "bracket should be Whale (4)");
}

#[test]
#[should_panic(expected: "Only registry can mint")]
fn test_unauthorized_mint() {
    let sbt = deploy_sbt();
    start_cheat_caller_address(sbt.contract_address, USER());
    sbt.mint_proof_sbt(USER(), 1);
    stop_cheat_caller_address(sbt.contract_address);
}

#[test]
#[should_panic(expected: "Invalid bracket")]
fn test_invalid_bracket() {
    let sbt = deploy_sbt();
    start_cheat_caller_address(sbt.contract_address, REGISTRY());
    sbt.mint_proof_sbt(USER(), 5); // invalid
    stop_cheat_caller_address(sbt.contract_address);
}
