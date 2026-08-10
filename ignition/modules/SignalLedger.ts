import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("SignalLedgerModule", (m) => {
  const signalLedger = m.contract("SignalLedger");

  return { signalLedger };
});
