// Teach the client that `targetProgramdata` in issue_attestation is derivable:
// it is the BPF Upgradeable Loader PDA seeded by the target program's address.
// The Anchor IDL can't express this (the seeds belong to another program's
// derivation that Anchor only checks at runtime), so we add it here.
import {
  accountValueNode,
  pdaNode,
  pdaSeedValueNode,
  pdaValueNode,
  publicKeyTypeNode,
  setInstructionAccountDefaultValuesVisitor,
  variablePdaSeedNode,
} from 'codama';

const BPF_LOADER_UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111';

const programDataPda = pdaNode({
  name: 'programData',
  programId: BPF_LOADER_UPGRADEABLE,
  seeds: [variablePdaSeedNode('program', publicKeyTypeNode(), 'The upgradeable program id')],
  docs: ['Loader-v3 ProgramData account of an upgradeable program.'],
});

export default setInstructionAccountDefaultValuesVisitor([
  {
    instruction: 'issueAttestation',
    account: 'targetProgramdata',
    defaultValue: pdaValueNode(programDataPda, [
      pdaSeedValueNode('program', accountValueNode('targetProgram')),
    ]),
  },
]);
