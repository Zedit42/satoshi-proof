use satoshi_proof::proof_registry::{
    IProofRegistryDispatcher, IProofRegistryDispatcherTrait,
};
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address, stop_cheat_caller_address};

fn OWNER() -> starknet::ContractAddress {
    starknet::contract_address_const::<0x1234>()
}

fn deploy_registry() -> IProofRegistryDispatcher {
    let class = declare("ProofRegistry").unwrap().contract_class();
    let (addr, _) = class.deploy(@array![]).unwrap();
    IProofRegistryDispatcher { contract_address: addr }
}

#[test]
fn test_proof_count_starts_zero() {
    let reg = deploy_registry();
    assert!(reg.get_proof_count() == 0, "should be 0");
}

#[test]
fn test_get_proof_unregistered() {
    let reg = deploy_registry();
    let (hash, bracket, ts, valid) = reg.get_proof(OWNER());
    assert!(hash == 0, "hash should be 0");
    assert!(bracket == 0, "bracket should be 0");
    assert!(ts == 0, "ts should be 0");
    assert!(!valid, "should not be valid");
}

#[test]
fn test_has_valid_proof_unregistered() {
    let reg = deploy_registry();
    assert!(!reg.has_valid_proof(OWNER(), 0), "should be false");
}

#[test]
fn test_revoke_proof() {
    let reg = deploy_registry();
    // Revoking non-existent proof should work (no-op effectively)
    start_cheat_caller_address(reg.contract_address, OWNER());
    reg.revoke_proof();
    stop_cheat_caller_address(reg.contract_address);

    let (_, _, _, valid) = reg.get_proof(OWNER());
    assert!(!valid, "should not be valid after revoke");
}
